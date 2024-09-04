export type Block = {
  height: number;
  hash: string;
};

export type OnNewBlockCallbackFn<T extends Block> = (block: T) => Promise<void>;
export type OnReorgedBlockCallbackFn<T extends Block> = (
  block: T,
  preReorgBlock: T
) => Promise<void>;

export type TaskErrorHandling = "skip" | "retry";

export type GetBlockFn<T extends Block> = (height: number) => Promise<T | null>;
export type GetChainHeadFn = () => Promise<number | null>;
