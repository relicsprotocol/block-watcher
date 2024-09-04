import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_REORG_DEPTH,
  DEFAULT_RETRY_DELAY,
} from "./constants";
import {
  Block,
  GetBlockFn,
  GetChainHeadFn,
  OnNewBlockCallbackFn,
  OnReorgedBlockCallbackFn,
  TaskErrorHandling,
} from "./types";
import _ from "lodash";
import { processTask } from "./utils";

export class BlockWatcher<T extends Block> {
  // config
  private startBlock?: number;
  private _getBlock: GetBlockFn<T>;
  private _getChainHead: GetChainHeadFn;
  private pollInterval: number;
  private maxReorgDepth: number;
  private taskErrorHandling: TaskErrorHandling;

  // state
  private currentBlocks: T[];
  private newBlockCallbacks: OnNewBlockCallbackFn<T>[];
  private reorgedBlockCallbacks: OnReorgedBlockCallbackFn<T>[];
  private intervalId: NodeJS.Timeout | null;

  constructor(config: {
    getBlock: GetBlockFn<T>;
    getChainHead: GetChainHeadFn;
    startBlock?: number;
    pollInterval?: number;
    maxReorgDepth?: number;
    taskErrorHandling?: TaskErrorHandling;
  }) {
    this.startBlock = config.startBlock;

    // api methods
    this._getBlock = config.getBlock;
    this._getChainHead = config.getChainHead;

    // config
    this.pollInterval = config.pollInterval || DEFAULT_POLL_INTERVAL;
    this.maxReorgDepth = config.maxReorgDepth || DEFAULT_REORG_DEPTH;
    this.taskErrorHandling = config.taskErrorHandling || "retry";

    // initialize
    this.currentBlocks = [];
    this.intervalId = null;
    this.newBlockCallbacks = [];
    this.reorgedBlockCallbacks = [];
  }

  // MAIN
  private async pollChain(startBlock?: number) {
    let nextBlock: T | null = null;
    let reorgsInPrevBlock = true;

    // we handle all reorgs and make safe that we didn't get a new one while handling them
    while (reorgsInPrevBlock) {
      const savedChainHead = this.getHighestBlock();
      const nextHeight = savedChainHead?.height
        ? savedChainHead.height + 1
        : startBlock;

      if (!nextHeight)
        throw new Error("No start block provided and no blocks saved");

      nextBlock = await this.getBlock(nextHeight);

      if (this.currentBlocks.length) {
        // we check if our highest saved block got a reorg while we last touched it. If it hasn't been reorged, then no other block has been reorged (depends on the backend we are syncing from)
        const { reorged } = await this.isBlockReorged(
          this.currentBlocks[this.currentBlocks.length - 1]
        );
        reorgsInPrevBlock = reorged;
      } else {
        reorgsInPrevBlock = false;
      }

      // don't forget, this might take a while, so we have to check if there were new reorgs
      if (reorgsInPrevBlock) {
        await this.handleDetectedReorg();
      }
    }

    if (nextBlock) {
      await this.handleDetectedNewBlock(nextBlock);
    }

    this.intervalId = setTimeout(() => this.pollChain(), this.pollInterval);
  }

  // API
  private async getBlock(height: number): Promise<T | null> {
    try {
      const block = await this._getBlock(height);
      return block;
    } catch (error) {
      console.error(`Error fetching block ${height}:`, error);
      return null;
    }
  }

  private async getChainHead(): Promise<number> {
    try {
      const chainHead = await this._getChainHead();
      if (!chainHead) throw new Error("Chain head not found in response");
      return chainHead;
    } catch (error) {
      throw new Error(`Error fetching chain head: ${error}`);
    }
  }

  private async pollBlock(height: number): Promise<T> {
    let onchainBlock: null | T = null;
    while (!onchainBlock) {
      onchainBlock = await this.getBlock(height);
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_DELAY));
      if (!onchainBlock) {
        console.log(`Block ${height} not found, retrying...`);
      }
    }
    return onchainBlock;
  }

  private async pollChainHead(): Promise<number> {
    let chainHead: null | number = null;
    while (!chainHead) {
      chainHead = await this.getChainHead();
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_DELAY));
      if (!chainHead) {
        console.log(`Chain head not found, retrying...`);
      }
    }
    return chainHead;
  }

  // START
  public async start() {
    if (this.intervalId) throw new Error("Already started");

    const startBlock = this.startBlock || (await this.pollChainHead());

    this.pollChain(startBlock);
  }

  // CALLBACK REGISTRATION
  public onNewBlock(callback: OnNewBlockCallbackFn<T>) {
    this.newBlockCallbacks.push(callback);
  }

  public onReorgedBlock(callback: OnReorgedBlockCallbackFn<T>) {
    this.reorgedBlockCallbacks.push(callback);
  }

  // STATUS
  public async isAtChainHead(): Promise<boolean> {
    const highestBlock = this.getHighestBlock();
    if (!highestBlock) return false;
    return highestBlock.height === (await this.pollChainHead());
  }

  public getHighestBlock(): T | null {
    return _.last(this.currentBlocks) || null;
  }

  // REORG
  private async isBlockReorged(
    block: T
  ): Promise<{ reorged: boolean; updatedBlock: T }> {
    const savedBlock = this.currentBlocks.find(
      (b) => b.height === block.height
    );
    if (!savedBlock) {
      throw new Error(`Block ${block.height} not found in saved blocks`);
    }

    /**
     * It's not fully unlikely that during a reorg the block is not found in the first try
     * since it is not yet fully synced with whatever backend we are using.
     * So we poll the block until we get it.
     */
    const onchainBlock = await this.pollBlock(block.height);

    // that means that it is reorged and potentially also previous and next blocks are affected
    if (savedBlock.hash !== onchainBlock.hash) {
      console.log(`Block ${block.height} reorged`);
      return { reorged: true, updatedBlock: onchainBlock };
    }

    return { reorged: false, updatedBlock: block };
  }

  private async handleDetectedReorg() {
    // we go back from the newest block we have and collect the reorged blocks.
    const reversedBlocks = _.reverse(this.currentBlocks);

    for (const block of reversedBlocks) {
      const { reorged, updatedBlock } = await this.isBlockReorged(block);
      if (reorged) {
        // we replace the block with the onchain block
        const index = _.findIndex(
          this.currentBlocks,
          (b) => b.height === block.height
        );
        const preReorgBlock = _.cloneDeep(this.currentBlocks[index]);
        this.currentBlocks[index] = updatedBlock;
        await this.processReorgedBlockCallbacks(updatedBlock, preReorgBlock);
      } else {
        break;
      }
    }
  }

  // NEW BLOCK
  private async handleDetectedNewBlock(block: T) {
    this.currentBlocks.push(block);
    if (this.currentBlocks.length > this.maxReorgDepth) {
      this.currentBlocks.shift();
    }

    await this.processNewBlockCallbacks(block);
  }

  // CALLBACK HANDLING
  private async processNewBlockCallbacks(block: T) {
    for (const callback of this.newBlockCallbacks) {
      // we infinitely retry the callback until it succeeds
      await processTask(() => callback(block), {
        retryDelay: DEFAULT_RETRY_DELAY,
        taskErrorHandling: this.taskErrorHandling,
      });
    }
  }

  private async processReorgedBlockCallbacks(block: T, preReorgBlock: T) {
    for (const callback of this.reorgedBlockCallbacks) {
      // we infinitely retry the callback until it succeeds
      await processTask(() => callback(block, preReorgBlock), {
        retryDelay: DEFAULT_RETRY_DELAY,
        taskErrorHandling: this.taskErrorHandling,
      });
    }
  }
}
