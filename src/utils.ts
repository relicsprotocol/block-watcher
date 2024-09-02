type Config = {
  taskErrorHandling: TaskErrorHandling;
  retryDelay: number; // in milliseconds
};
export type TaskErrorHandling = "skip" | "retry";

export const processTask = async (
  task: () => Promise<void>,
  config: Config = { taskErrorHandling: "retry", retryDelay: 1000 }
) => {
  const attemptTask = async (): Promise<void> => {
    try {
      await task();
    } catch (error) {
      console.error("Error processing task:", error);
      if (config.taskErrorHandling === "retry") {
        console.log("Retrying task...");
        setTimeout(attemptTask, config.retryDelay);
      }
      console.log("Skipping task...");
      // If the mode is 'skip', do nothing; the task will be skipped.
    }
  };

  await attemptTask();
};

export const retry = async <T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000,
  endlessRetry: boolean = false
): Promise<T> => {
  let attempt = 0;

  while (endlessRetry || attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed:`, error);
      attempt++;

      // If it's not endless retry mode and we've reached the max attempts, throw an error
      if (!endlessRetry && attempt >= retries) {
        throw new Error(`Failed after ${retries} retries`);
      }

      // Wait for the specified delay before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This is technically unreachable in endlessRetry mode, but needed for TypeScript
  throw new Error(`Failed after ${retries} retries`);
};
