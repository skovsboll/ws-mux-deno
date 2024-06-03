export async function pipeToStdout(readable: ReadableStream<Uint8Array>) {
  const reader = readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const writer = Deno.stdout.writable.getWriter();
      try {
        await writer.write(value);
      } finally {
        writer.releaseLock();
      }
    }
  } catch (error) {
    console.error("Error while reading stdout:", error);
  }
}
