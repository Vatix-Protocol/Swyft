export const SWYFT_NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "TESTNET") as "TESTNET" | "PUBLIC";
export const WALLET_STORAGE_KEY = "swyft_wallet_address";
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
