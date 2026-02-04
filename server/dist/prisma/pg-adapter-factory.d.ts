export declare function createLocalPgAdapterFactory(connectionString: string): {
    provider: string;
    adapterName: string;
    connect(): Promise<any>;
};
