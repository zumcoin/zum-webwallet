let global : any = typeof window !== 'undefined' ? window : self;
global.config = {
    apiUrl: typeof window !== 'undefined' && window.location ? window.location.href.substr(0, window.location.href.lastIndexOf('/') + 1) + 'api/' : 'http://webwallet.zumcoin.org/api/',
    mainnetExplorerUrl: "http://explorer.zumcoin.org/",
    testnetExplorerUrl: "http://testnet.zumcoin.org/",
    testnet: false,
    coinUnitPlaces: 8,
    txMinConfirms: 2,         // corresponds to CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE in Monero
    txCoinbaseMinConfirms: 30, // corresponds to CRYPTONOTE_MINED_MONEY_UNLOCK_WINDOW in Monero
    addressPrefix: 4153412,
    integratedAddressPrefix: 0,
    addressPrefixTestnet: 0,
    integratedAddressPrefixTestnet: 0,
    subAddressPrefix: 0,
    subAddressPrefixTestnet: 0,
    feePerKB: new JSBigInt('10000000'),//20^10 - for testnet its not used, as fee is dynamic.
    dustThreshold: new JSBigInt('10'),//10^10 used for choosing outputs/change - we decompose all the way down if the receiver wants now regardless of threshold
    defaultMixin: 0, // default value mixin
    idleTimeout: 30,
    idleWarningDuration: 20,

    coinSymbol: 'ZUM',
    openAliasPrefix: "zum",
    coinName: 'ZumCoin',
    coinUriPrefix: 'zumcoin:',
    avgBlockTime: 120,
    maxBlockNumber: 500000000,
};