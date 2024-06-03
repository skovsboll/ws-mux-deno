#!/usr/bin/env deno run --allow-net --allow-write

/**
 * Runs a simple websocket server that writes all messages to
 * a file.
 *
 * Usage:
 *
 *    ./server.ts <file> <port>
 *
 * It's meant to be called by mux.ts
 */

const context: { file?: Deno.FsFile } = {
  file: undefined,
};

const sockets = new Set<WebSocket>();

Deno.serve({ port: parseInt(Deno.args[1]) }, (req: Request) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 501 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    log("a client connected!");
    sockets.add(socket);

    if (!context.file) {
      log(`Opening ${Deno.args[0]}!`);
      context.file = Deno.openSync("models/" + Deno.args[0], {
        write: true,
        create: true,
        truncate: false,
      });
    }
  });

  socket.addEventListener("message", (event) => {
    log(event.data);

    if (!context.file) {
      error("¡File not open!");
    } else {
      context.file.writeSync(new TextEncoder().encode(event.data + "\n"));
    }
  });

  socket.addEventListener("close", () => {
    log("client disconnected!");
    sockets.delete(socket);

    if (sockets.size === 0 && context.file) {
      log(`Closing ${Deno.args[0]}!`);
      context.file.close();
      context.file = undefined;
      log("Exiting!");
      Deno.exit(0);
    }
  });

  return response;
});

export function log(msg: string): void {
  const coloredGreenMsg = "\x1b[32m" + "SRV: " + msg + "\x1b[0m";
  console.log(coloredGreenMsg);
}

export function error(msg: string): void {
  const coloredRedMsg = "\x1b[31m" + "SRV: " + msg + "\x1b[0m";
  console.log(coloredRedMsg);
}
