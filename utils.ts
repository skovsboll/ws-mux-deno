export async function pipeToStdout(readable: ReadableStream<Uint8Array>) {
  const reader = readable.getReader();
  const writer = Deno.stdout.writable.getWriter();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
  } catch (error) {
    console.error("Error while reading stdout:", error);
  } finally {
    writer.releaseLock();
  }
}

export function failAfter(timeoutMs: number): Promise<void> {
  return new Promise((_resolve, reject) => setTimeout(reject, timeoutMs));
}

export function retryUntil<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  retries: number = 5,
  delay: number = 1000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const attempt = async (retryCount: number) => {
      try {
        const result = await fn();
        if (condition(result)) {
          resolve(result);
        } else if (retryCount <= 0) {
          reject(new Error("Max retries reached"));
        } else {
          setTimeout(() => attempt(retryCount - 1), delay);
        }
      } catch (error) {
        if (retryCount <= 0) {
          reject(error);
        } else {
          setTimeout(() => attempt(retryCount - 1), delay);
        }
      }
    };

    attempt(retries);
  });
}
