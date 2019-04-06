declare var config : {
    apiUrl: string,
    miningUrl : string,
	mainnetExplorerUrl: string,
	testnetExplorerUrl: string,
	testnet: boolean,
	coinUnitPlaces: number,
	txMinConfirms: number,         // corresponds to CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE 
	txCoinbaseMinConfirms: number, // corresponds to CRYPTONOTE_MINED_MONEY_UNLOCK_WINDOW
	coinSymbol: string,
	openAliasPrefix: string,
	coinName: string,
	coinUriPrefix: string,
	addressPrefix: number,
	integratedAddressPrefix: number,
	addressPrefixTestnet: number,
	integratedAddressPrefixTestnet: number,
	subAddressPrefix: number,
	subAddressPrefixTestnet: number,
	feePerKB: any,
	dustThreshold: any,
	defaultMixin: number, // default mixin
	txChargeAddress: string,
	idleTimeout: number,
	idleWarningDuration: number,
	maxBlockNumber: number,
	avgBlockTime: number,
};