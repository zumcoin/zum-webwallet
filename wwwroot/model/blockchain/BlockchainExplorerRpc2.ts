/*
 * Copyright (c) 2018, Gnock
 * Copyright (c) 2019 ZumCoin Development Team
 * Copyright (c) 2018, The Plenteum Project
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { BlockchainExplorer } from "./BlockchainExplorer";
import { Wallet } from "../Wallet";
import { TransactionsExplorer, TX_EXTRA_TAG_PUBKEY } from "../TransactionsExplorer";
import { CryptoUtils } from "../CryptoUtils";
import { Transaction } from "../Transaction";
import { MathUtil } from "../MathUtil";

export class WalletWatchdog {

    wallet: Wallet;
    explorer: BlockchainExplorerRpc2;

    constructor(wallet: Wallet, explorer: BlockchainExplorerRpc2) {
        this.wallet = wallet;
        this.explorer = explorer;

        this.initWorker();
        this.initMempool();
    }

    initWorker() {
        let self = this;
        this.workerProcessing = new Worker('./workers/TransferProcessingEntrypoint.js');
        this.workerProcessing.onmessage = function (data: MessageEvent) {
            let message: string | any = data.data;
            // console.log(message);
            if (message === 'ready') {
                self.signalWalletUpdate();
            } else if (message === 'readyWallet') {
                self.workerProcessingReady = true;
            } else if (message.type) {
                if (message.type === 'processed') {
                    let transactions = message.transactions;
                    if (transactions.length > 0) {
                        for (let tx of transactions) {
                            self.wallet.addNew(Transaction.fromRaw(tx));
                        }
                        self.signalWalletUpdate();
                    }
                    if (self.workerCurrentProcessing.length > 0) {
                        let transactionHeight = self.workerCurrentProcessing[self.workerCurrentProcessing.length - 1].height;
                        if (typeof transactionHeight !== 'undefined')
                            self.wallet.lastHeight = transactionHeight;
                    }

                    self.workerProcessingWorking = false;
                }
            }
        };
    }

    signalWalletUpdate() {
        let self = this;
        this.lastBlockLoading = -1;//reset scanning
        this.workerProcessing.postMessage({
            type: 'initWallet',
            wallet: this.wallet.exportToRaw(true)
        });
        clearInterval(this.intervalTransactionsProcess);
        this.intervalTransactionsProcess = setInterval(function () {
            self.checkTransactionsInterval();
        }, this.wallet.options.readSpeed);
    }

    intervalMempool = 0;
    initMempool() {
        let self = this;
        if (this.intervalMempool === 0) {
            this.intervalMempool = setInterval(function () {
                self.checkMempool();
            }, 2 * 60 * 1000);
        }
        self.checkMempool();
    }

    stopped: boolean = false;

    stop() {
        clearInterval(this.intervalTransactionsProcess);
        this.transactionsToProcess = [];
        clearInterval(this.intervalMempool);
        this.stopped = true;
    }

    checkMempool(): boolean {
        let self = this;
        if (this.lastMaximumHeight === 0 || this.lastBlockLoading === -1 || (this.lastMaximumHeight - this.lastBlockLoading > 1)) {//only check memory pool if the user is up to date to ensure outs & ins will be found in the wallet
            return false;
        }

        this.wallet.txsMem = [];
        this.wallet.fusionTxs = [];
        this.explorer.getTransactionPool().then(function (data: any) {
            if (typeof data !== 'undefined')
                for (let rawTx of data) {
                    let tx = TransactionsExplorer.parse(rawTx, self.wallet);
                    if (tx !== null) {
                        if (tx.isFusionTx()) {
                            self.wallet.fusionTxs.push(tx);
                        } else {
                            self.wallet.txsMem.push(tx);
                        }
                    }
                }
        }).catch(function () { });
        return true;
    }

    terminateWorker() {
        this.workerProcessing.terminate();
        this.workerProcessingReady = false;
        this.workerCurrentProcessing = [];
        this.workerProcessingWorking = false;
        this.workerCountProcessed = 0;
    }

    transactionsToProcess: RawDaemonTransaction[] = [];
    intervalTransactionsProcess = 0;

    workerProcessing !: Worker;
    workerProcessingReady = false;
    workerProcessingWorking = false;
    workerCurrentProcessing: RawDaemonTransaction[] = [];
    workerCountProcessed = 0;

    checkTransactions(rawTransactions: RawDaemonTransaction[]) {
        for (let rawTransaction of rawTransactions) {
            let height = rawTransaction.height;
            if (typeof height !== 'undefined') {
                let transaction = TransactionsExplorer.parse(rawTransaction, this.wallet);
                if (transaction !== null) {
                    this.wallet.addNew(transaction);
                }
                if (height - this.wallet.lastHeight >= 2) {
                    this.wallet.lastHeight = height - 1;
                }
            }
        }
        if (this.transactionsToProcess.length == 0) {
            this.wallet.lastHeight = this.lastBlockLoading;
        }
    }

    checkTransactionsInterval() {

        //somehow we're repeating and regressing back to re-process Tx's 
        //loadHistory getting into a stack overflow ?
        //need to work out timinings and ensure process does not reload when it's already running... 

        if (this.workerProcessingWorking || !this.workerProcessingReady) {
            return;
        }

        //we destroy the worker in charge of decoding the transactions every 250 transactions to ensure the memory is not corrupted
        //cnUtil bug, see https://github.com/mymonero/mymonero-core-js/issues/8
        if (this.workerCountProcessed >= 500) {
            console.log('Recreate worker..');
            this.terminateWorker();
            this.initWorker();
            return;
        }

        let transactionsToProcess: RawDaemonTransaction[] = this.transactionsToProcess.splice(0, 25); //process 25 tx's at a time
        if (transactionsToProcess.length > 0) {
            this.workerCurrentProcessing = transactionsToProcess;
            this.workerProcessing.postMessage({
                type: 'process',
                transactions: transactionsToProcess
            });
            ++this.workerCountProcessed;
            this.workerProcessingWorking = true;
        } else {
            clearInterval(this.intervalTransactionsProcess);
            this.intervalTransactionsProcess = 0;
        }
    }

    processTransactions(transactions: RawDaemonTransaction[]) {
        let transactionsToAdd = [];
        for (let tr of transactions) {
            if (typeof tr.height !== 'undefined')
                if (tr.height > this.wallet.lastHeight) {
                    transactionsToAdd.push(tr);
                }
        }
        this.transactionsToProcess.push.apply(this.transactionsToProcess, transactionsToAdd);
        if (this.intervalTransactionsProcess === 0) {
            let self = this;
            this.intervalTransactionsProcess = setInterval(function () {
                self.checkTransactionsInterval();
            }, this.wallet.options.readSpeed);
        }

    }


    lastBlockLoading = -1;
    lastMaximumHeight = 0;

    loadHistory() {
        if (this.stopped) return;

        if (this.lastBlockLoading === -1) this.lastBlockLoading = this.wallet.lastHeight;
        let self = this;
        //don't reload until it's finished processing the last batch of transactions
        if (this.workerProcessingWorking || !this.workerProcessingReady) {
            setTimeout(function () {
                self.loadHistory();
            }, 500);
            return;
        }
        if (this.transactionsToProcess.length > 100) {
            //to ensure no pile explosion
            setTimeout(function () {
                self.loadHistory();
            }, 2 * 1000);
            return;
        }

        // console.log('checking');
        this.explorer.getHeight().then(function (height) {
            //console.log("loading height:", self.lastBlockLoading,height);
            if (height > self.lastMaximumHeight) self.lastMaximumHeight = height;
            if (self.lastBlockLoading !== height) {
                let previousStartBlock = self.lastBlockLoading;
                let startBlock = Math.floor(self.lastBlockLoading / 100) * 100;
                // console.log('=>',self.lastBlockLoading, endBlock, height, startBlock, self.lastBlockLoading);
                console.log('load block from ' + startBlock + ' (actual block: ' + previousStartBlock + ') at height :' + height);
                if (previousStartBlock <= height) {
                    self.explorer.getTransactionsForBlocks(previousStartBlock).then(function (transactions: RawDaemonTransaction[]) {
                        //to ensure no pile explosion
                        if (transactions.length > 0) {
                            let lastTx = transactions[transactions.length - 1];

                            if (typeof lastTx.height !== 'undefined') {
                                self.lastBlockLoading = lastTx.height + 2; //we're operating one block behind to give the Tx Caching process a chance to catch up
                            }
                        }
                        self.processTransactions(transactions);
                        setTimeout(function () {
                            self.loadHistory();
                        }, 1);// then try load history again... 
                    }).catch(function () {
                        setTimeout(function () {
                            self.loadHistory();
                        }, 30 * 1000);//retry 30s later if an error occurred
                    });
                } else {
                    //if we're on the current height, then only try sync every 30 seconds... 
                    setTimeout(function () {
                        self.loadHistory();
                    }, 30000);// then try load history again... 
                }
            } else {
                setTimeout(function () {
                    self.loadHistory();
                }, 30 * 1000);//retry 30s later if an error occurred
            }
        }).catch(function () {
            setTimeout(function () {
                self.loadHistory();
            }, 30 * 1000);//retry 30s later if an error occurred
        });
    }


}

export class BlockchainExplorerRpc2 implements BlockchainExplorer {

    // testnet : boolean = true;
    serverAddress = config.apiUrl;

    heightCache = 0;
    heightLastTimeRetrieve = 0;
    getHeight(): Promise<number> {
        if (Date.now() - this.heightLastTimeRetrieve < 20 * 1000 && this.heightCache !== 0) {
            return Promise.resolve(this.heightCache);
        }
        let self = this;
        this.heightLastTimeRetrieve = Date.now();
        return new Promise<number>(function (resolve, reject) {
            $.ajax({
                url: self.serverAddress + 'getheight',
                method: 'GET'
            }).done(function (raw: any) {
                // self.heightCache = raw.height;
                // resolve(raw.height);
                self.heightCache = parseInt(raw);
                resolve(self.heightCache);
            }).fail(function (data: any) {
                reject(data);
            });
        });
    }

    // getDaemonUrl(){
    // 	return this.testnet ? 'http://localhost:48081/' : 'http://localhost:38081/';
    // }

    scannedHeight: number = 0;

    getScannedHeight(): number {
        return this.scannedHeight;
    }

    watchdog(wallet: Wallet): WalletWatchdog {
        let watchdog = new WalletWatchdog(wallet, this);
        watchdog.loadHistory();
        return watchdog;
    }

    getTransactionsForBlocks(startBlock: number): Promise<RawDaemonTransaction[]> {
        let self = this;
        return new Promise<RawDaemonTransaction[]>(function (resolve, reject) {
            $.ajax({
                url: self.serverAddress + 'blockchain?height=' + startBlock,
                method: 'GET'
            }).done(function (transactions: any) {
                resolve(JSON.parse(transactions));
            }).fail(function (data: any) {
                reject(data);
            });
        });
    }

    getTransactionPool(): Promise<RawDaemonTransaction[]> {
        let self = this;
        return new Promise<RawDaemonTransaction[]>(function (resolve, reject) {
            $.ajax({
                url: self.serverAddress + 'txpool',
                method: 'GET',
            }).done(function (transactions: any) {
                if (transactions !== null) {
                    resolve(JSON.parse(transactions));
                }
            }).fail(function (data: any) {
                console.log('REJECT');
                try {
                    console.log(JSON.parse(data.responseText));
                } catch (e) {
                    console.log(e);
                }
                reject(data);
            });
        });
    }

    nonRandomBlockConsumed = false;

    existingOuts: any[] = [];
    getRandomOuts(nbOutsNeeded: number, initialCall = true): Promise<any[]> {
        let self = this;
        if (initialCall) {
            self.existingOuts = [];
        }

        return this.getHeight().then(function (height: number) {
            let txs: RawDaemonTransaction[] = [];
            let promises = [];

            let randomBlocksIndexesToGet: number[] = [];
            let numOuts = height;

            for (let i = 0; i < nbOutsNeeded; ++i) {
                let selectedIndex: number = -1;
                do {
                    selectedIndex = MathUtil.randomTriangularSimplified(numOuts);
                    if (selectedIndex >= height - config.txCoinbaseMinConfirms)
                        selectedIndex = -1;
                } while (selectedIndex === -1 || randomBlocksIndexesToGet.indexOf(selectedIndex) !== -1);
                randomBlocksIndexesToGet.push(selectedIndex);

                let promise = self.getTransactionsForBlocks(Math.floor(selectedIndex / 100) * 100).then(function (rawTransactions: RawDaemonTransaction[]) {
                    txs.push.apply(txs, rawTransactions);
                });
                promises.push(promise);
            }

            return Promise.all(promises).then(function () {
                let txCandidates: any = {};
                for (let iOut = 0; iOut < txs.length; ++iOut) {
                    let tx = txs[iOut];

                    if (
                        (typeof tx.height !== 'undefined' && randomBlocksIndexesToGet.indexOf(tx.height) === -1) ||
                        typeof tx.height === 'undefined'
                    ) {
                        continue;
                    }

                    for (let output_idx_in_tx = 0; output_idx_in_tx < tx.vout.length; ++output_idx_in_tx) {
                        let globalIndex = output_idx_in_tx;
                        if (typeof tx.global_index_start !== 'undefined')
                            globalIndex += tx.global_index_start;

                        let newOut = {
                            public_key: tx.vout[output_idx_in_tx].key,
                            global_index: globalIndex,
                            // global_index: count,
                        };
                        if (typeof txCandidates[tx.height] === 'undefined') txCandidates[tx.height] = [];
                        txCandidates[tx.height].push(newOut);
                    }
                }

                //console.log(txCandidates);

                let selectedOuts = [];
                for (let txsOutsHeight in txCandidates) {
                    let outIndexSelect = MathUtil.getRandomInt(0, txCandidates[txsOutsHeight].length - 1);
                    //console.log('select ' + outIndexSelect + ' for ' + txsOutsHeight + ' with length of ' + txCandidates[txsOutsHeight].length);
                    selectedOuts.push(txCandidates[txsOutsHeight][outIndexSelect]);
                }

                //console.log(selectedOuts);

                return selectedOuts;
            });
        });
    }

    sendRawTx(rawTx: string) {
        let self = this;
        return new Promise(function (resolve, reject) {
            //console.log('sending:', rawTx);
            $.post(self.serverAddress + 'sendrawtx', { '': rawTx })
                .done(function (transactions: any) {
                    if (transactions.status && transactions.status == 'OK') {
                        resolve(transactions);
                    } else
                        reject(transactions);
                }).fail(function (data: any) {
                    reject(data);
                });
        });
    }
}