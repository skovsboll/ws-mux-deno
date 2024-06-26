## ws-mux-deno

A simple websocket multiplexer in Deno.

## Pre-requisites

https://deno.com/

## Running

In a shell:

```bash
./mux.ts
```

Then connect a websocket from any browser using the console:

```javascript
const ws = new WebSocket("ws://localhost:8000/models/garbage.txt")

ws.onmessage = console.log

ws.send("Mjallo")
```

Do the same from another browser and watch the messages sent go through the mux, into the server, and written to the `models/garbage.txt` file.

The other file, server.ts, is started by mux.ts, not directly. It takes the file name and port number as arguments so each file has its own port number.

When the last client disconnects, the server process will be killed so save resources.
