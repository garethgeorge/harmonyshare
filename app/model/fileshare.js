const DiskCache = require("../../lib/diskcache");
const AsyncLock = require("async-lock");
const uuidv4 = require("uuid").v4;

const cache = new DiskCache("./.cache");

module.exports = class FileShare {
  constructor(socket, chunkSize) {
    this.chunkSize = chunkSize;
    this.socket = socket;
    this.id = uuidv4();
    this.fileInfo = null;

    this.lock = new AsyncLock();
    this.chunkWaiters = {};
    this.requestedChunks = {};

    // put the chunk in the cache
    socket.emit("server:session-info", {
      id: this.id,
      chunkSize: this.chunkSize,
    });

    this.socket.on("client:file-info", (fileInfo) => {
      console.log("FILE INFO FROM CLIENT: ", fileInfo);
      this.fileInfo = fileInfo;
    });

    this.socket.on("client:send-chunk", async (chunkIdx, data) => {
      console.log("RECEIVED CHUNK: ", chunkIdx, data);
      await this.lock.acquire(chunkIdx, async () => {
        await cache.put(this.id + "/" + chunkIdx, data);
        for (const chunkWaiter of this.chunkWaiters[chunkIdx]) {
          chunkWaiter(data);
        }
      });
    });
  }

  getChunk(chunkIdx) {
    return new Promise((accept, reject) => {
      if (!this.fileInfo)
        return reject(new Error("file info not yet available"));
      if (chunkIdx >= Math.ceil(this.fileInfo.fileSize / this.chunkSize)) {
        return reject(new Error("chunk index out of range: " + chunkIdx));
      }

      // emit a chunk request if this chunk has not yet been fetched
      if (!this.requestedChunks[chunkIdx]) {
        this.requestedChunks[chunkIdx] = true;
        this.socket.emit("server:request-chunk", chunkIdx);
        console.log("requesting chunk from client");
      } else console.log("waiting for chunk from cache");

      this.lock.acquire(chunkIdx, async () => {
        const data = await cache.get(this.id + "/" + chunkIdx);
        if (data) {
          accept(data);
        } else {
          if (!this.chunkWaiters[chunkIdx]) this.chunkWaiters[chunkIdx] = [];
          this.chunkWaiters[chunkIdx].push(accept);
        }
      });
    });
  }

  get fileSize() {
    return this.fileInfo.fileSize;
  }

  get fileName() {
    return this.fileInfo.fileName;
  }

  get mimetype() {
    return this.fileInfo.mimetype;
  }
};
