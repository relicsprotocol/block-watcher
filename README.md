# BlockWatcher

[![npm version](https://img.shields.io/npm/v/@relicsprotocol/block-watcher.svg)](https://www.npmjs.com/package/@relicsprotocol/block-watcher)
[![License](https://img.shields.io/github/license/relicsprotocol/block-watcher)](LICENSE)

**BlockWatcher** is a utility library for continuously monitoring a blockchain for new blocks, detecting reorgs, and responding to these events with customizable callbacks. It gives you control over how to fetch blocks, how often to poll, and how to handle reorgs, making it easy to stay in sync with a blockchain in real time.

> **Repository:** [https://github.com/relicsprotocol/block-watcher](https://github.com/relicsprotocol/block-watcher)

## Table of Contents

- [Key Features](#key-features)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [API Overview](#api-overview)
  - [Constructor](#constructor)
  - [Public Methods](#public-methods)
  - [Callback Registration](#callback-registration)
- [Reorg Handling](#reorg-handling)
- [Advanced Usage](#advanced-usage)
- [Example](#example)
- [Contributing](#contributing)
- [License](#license)

---

## Key Features

- **Live polling** for new blocks
- **Reorg detection** and handling
- **Flexible configuration** for `pollInterval`, `maxReorgDepth`, and error handling
- **Callback-based architecture** for responding to new blocks and reorged blocks
- **Extendable** with custom block data and logic

---

## Installation

```bash
npm install @relicsprotocol/block-watcher
```

Or using Yarn:

```bash
yarn add @relicsprotocol/block-watcher
```

---

## Basic Usage

Below is a minimal example of how to set up and start the **BlockWatcher**.

```ts
import { BlockWatcher, Block } from "@relicsprotocol/block-watcher";

// 1. Define how to fetch a block by height
const getBlock = async (height: number): Promise<Block | null> => {
  // Your code to fetch a block by height
  return {
    hash: "0000...abc",
    height,
    // any other properties you need
  };
};

// 2. Define how to fetch the chain head (latest block height)
const getChainHead = async (): Promise<number | null> => {
  // Your code to fetch the current highest block height
  return 123456;
};

// 3. Create a new instance
const blockWatcher = new BlockWatcher({
  getBlock,
  getChainHead,
  pollInterval: 8000, // optional, default is 5000 (ms)
  maxReorgDepth: 10, // optional, default is 6
});

// 4. Add callbacks to handle new blocks or reorged blocks
blockWatcher.onNewBlock((block) => {
  console.log("New block detected:", block.height, block.hash);
});

blockWatcher.onReorgedBlock((updatedBlock, preReorgBlock) => {
  console.log(
    "Block reorged:",
    preReorgBlock.height,
    "->",
    updatedBlock.height
  );
});

// 5. Start the watcher
blockWatcher
  .start()
  .then(() => console.log("BlockWatcher started."))
  .catch((err) => console.error("Failed to start:", err));
```

---

## API Overview

### Constructor

```ts
new BlockWatcher<T extends Block>(config: {
  getBlock: GetBlockFn<T>;
  getChainHead: GetChainHeadFn;
  preStartBlockState?: T[];
  startBlock?: number;
  pollInterval?: number;
  maxReorgDepth?: number;
  taskErrorHandling?: TaskErrorHandling;
})
```

| Option               | Type                | Required | Default   | Description                                                                                                               |
| -------------------- | ------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `getBlock`           | `GetBlockFn<T>`     | Yes      | -         | Function to fetch a block by height (return `null` if block not found).                                                   |
| `getChainHead`       | `GetChainHeadFn`    | Yes      | -         | Function that returns the current chain head height (return `null` if not found).                                         |
| `preStartBlockState` | `T[]`               | No       | `[]`      | An array of previously known blocks sorted by height. Used to detect reorgs before new polling begins.                    |
| `startBlock`         | `number`            | No       | -         | The height at which to start polling. If omitted, the watcher fetches the current chain head on first start.              |
| `pollInterval`       | `number`            | No       | `5000` ms | How often to check for a new block if none is found immediately.                                                          |
| `maxReorgDepth`      | `number`            | No       | `6`       | How many recent blocks to keep in memory for reorg checks.                                                                |
| `taskErrorHandling`  | `"skip" \| "retry"` | No       | `"retry"` | Determines how to handle errors when firing callbacks. `"retry"` will keep retrying, `"skip"` will ignore callback errors |

---

### Public Methods

#### `start()`

Starts polling the chain. Returns a promise that resolves once the initial poll is complete (or rejects on error).

```ts
blockWatcher.start().then(() => {
  console.log("Watcher started");
});
```

#### `isAtChainHead()`

Returns a boolean indicating if the watcher’s highest known block height matches the real chain head.

```ts
const isSynced = await blockWatcher.isAtChainHead();
console.log("Is the watcher synced?", isSynced);
```

#### `getHighestBlock()`

Returns the highest block the watcher has saved, or `null` if it doesn’t have any blocks yet.

```ts
const currentTip = blockWatcher.getHighestBlock();
if (currentTip) {
  console.log("Highest block:", currentTip.height, currentTip.hash);
} else {
  console.log("No blocks in memory yet");
}
```

---

### Callback Registration

#### `onNewBlock(callback: OnNewBlockCallbackFn<T>)`

Register a function to be called whenever a new block arrives. The callback receives the new block as an argument.

```ts
blockWatcher.onNewBlock((block) => {
  console.log("Received a new block:", block.height, block.hash);
});
```

#### `onReorgedBlock(callback: OnReorgedBlockCallbackFn<T>)`

Register a function to be called whenever a block is replaced due to a chain reorg. The callback receives two arguments:

1. `updatedBlock`: The new/updated block at that height.
2. `preReorgBlock`: The old block that used to occupy that height.

```ts
blockWatcher.onReorgedBlock((updatedBlock, preReorgBlock) => {
  console.log(
    "Block reorged from",
    preReorgBlock.height,
    "to",
    updatedBlock.height
  );
});
```

---

## Reorg Handling

**BlockWatcher** automatically checks for reorgs by comparing the hash of the most recent known block with the hash returned by the chain at the same height. If they differ, it triggers the reorg logic:

1. Moves backward from the highest block in memory, checking each block for potential reorg.
2. Replaces any blocks whose hash has changed.
3. Fires the `onReorgedBlock` callbacks for each replaced block.

Because it retains up to `maxReorgDepth` blocks in memory, **BlockWatcher** can handle reorgs that go back that many blocks.

---

## Advanced Usage

### Pre-loaded Blocks

If your application already knows about some recent blocks and you want **BlockWatcher** to account for them (and check if they’ve been reorged) before polling for new blocks, set `preStartBlockState` and `startBlock`:

```ts
const knownBlocks = getLastFewBlocksFromDatabase();
const sortedBlocks = knownBlocks.sort((a, b) => a.height - b.height);

const watcher = new BlockWatcher({
  getBlock,
  getChainHead,
  preStartBlockState: sortedBlocks,
  startBlock: sortedBlocks[sortedBlocks.length - 1].height + 1,
});
```

### Error Handling in Callbacks

By default, if a callback throws an error, **BlockWatcher** will keep retrying indefinitely (`taskErrorHandling: "retry"`). You can change this by setting `taskErrorHandling: "skip"`, which will ignore the error and move on:

```ts
const watcher = new BlockWatcher({
  getBlock,
  getChainHead,
  taskErrorHandling: "skip", // will skip failed callbacks instead of retrying
});
```

---

## Example

Here’s a more complete example combining pre-loaded blocks and callback logic:

```ts
import { BlockWatcher, Block } from "@relicsprotocol/block-watcher";
import { dbGetBlocks, dbUpdateOnNewBlock, dbHandleReorg } from "./database";

interface MyBlock extends Block {
  // custom fields if you want
  transactions: string[];
}

const getBlock = async (height: number): Promise<MyBlock | null> => {
  // ... fetch data from your node or API
  return {
    hash: "0000abcd1234",
    height,
    transactions: [],
  };
};

const getChainHead = async (): Promise<number | null> => {
  // ... fetch current chain head
  return 10000;
};

(async () => {
  try {
    // Retrieve the last few known blocks from your DB
    const knownBlocks = dbGetBlocks(10); // your function to get blocks
    const sortedBlocks = knownBlocks.sort((a, b) => a.height - b.height);

    const watcher = new BlockWatcher<MyBlock>({
      getBlock,
      getChainHead,
      pollInterval: 8000,
      maxReorgDepth: 15,
      preStartBlockState: sortedBlocks,
      startBlock: sortedBlocks.length
        ? sortedBlocks[sortedBlocks.length - 1].height + 1
        : undefined,
      taskErrorHandling: "retry", // or "skip"
    });

    // callbacks
    watcher.onNewBlock(async (block) => {
      console.log("[NEW BLOCK] Height:", block.height);
      await dbUpdateOnNewBlock(block);
    });

    watcher.onReorgedBlock(async (updatedBlock, preReorgBlock) => {
      console.warn(
        "[REORG] Old:",
        preReorgBlock.height,
        "New:",
        updatedBlock.height
      );
      await dbHandleReorg(updatedBlock, preReorgBlock);
    });

    await watcher.start();
    console.log("BlockWatcher has started.");
  } catch (error) {
    console.error("Error starting BlockWatcher:", error);
  }
})();
```

---

## Contributing

Contributions and issues are welcome. Please open an [Issue](https://github.com/relicsprotocol/block-watcher/issues) or [Pull Request](https://github.com/relicsprotocol/block-watcher/pulls).

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/my-new-feature`
5. Create a new Pull Request

---

## License

[MIT](LICENSE)

```

```

```

```
