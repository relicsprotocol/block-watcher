export type Block = {
  height: number;
  hash: string;
};

export type OnNewBlockCallbackFn = (
  height: number,
  hash: string
) => Promise<void>;

export type OnReorgedBlockCallbackFn = (
  height: number,
  hash: string
) => Promise<void>;

export type TaskErrorHandling = "skip" | "retry";
