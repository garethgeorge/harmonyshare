const DiskCache = require("../../lib/diskcache");
const AsyncLock = require("async-lock");
const uuidv4 = require("uuid").v4;
const debug = require("debug")("model:fileshare");
const crypto = require("crypto");
const config = require("../../config.js");

const cache = new DiskCache(
  config.CACHE_LOCATION,
  config.CACHE_SIZE_MB * 1024 * 1024
);

module.exports = class FileShare {
  constructor(socket, chunkSize) {
    this.id = crypto.randomBytes(8).toString("hex");
    this.ownerSecret = crypto.randomBytes(8).toString("hex"); // secret sent to owner, used to authenticate
    this.chunkSize = chunkSize;
    this.fileInfo = null;

    this.lock = new AsyncLock(); // no locks blocking for more than 10 seconds
    this.chunkWaiters = {};
    this.requestedChunks = {};

    this.setSocket(socket);
  }

  setSocket(socket) {
    this.socket = socket;
    debug("attaching new socket to session " + this.id);

    // put the chunk in the cache
    this.socket.emit("server:session-info", {
      id: this.id,
      chunkSize: this.chunkSize,
      ownerSecret: this.ownerSecret, // this is a token that the owner uses to auth HTTP requests
    });

    this.socket.on("client:file-info", (fileInfo) => {
      debug("FILE INFO FROM CLIENT: ", fileInfo);
      this.fileInfo = fileInfo;
    });

    this.socket.on("client:send-chunk", async (chunkIdx, data) => {
      await this.deliverChunk(chunkIdx, data);
    });

    for (const chunkIdx of Object.keys(this.requestedChunks)) {
      debug(
        `sesion ${this.id} found that chunk ${chunkIdx} was requested but no delivered, rerequesting`
      );
      this.socket.emit("server:request-chunk", parseInt(chunkIdx));
    }
  }

  getChunk(chunkIdx) {
    return new Promise((accept, reject) => {
      if (!this.fileInfo)
        return reject(new Error("file info not yet available"));
      if (chunkIdx >= Math.ceil(this.fileInfo.fileSize / this.chunkSize)) {
        return reject(new Error("chunk index out of range: " + chunkIdx));
      }

      this.lock.acquire(chunkIdx, async () => {
        const data = await cache.get(this.id + "/" + chunkIdx);
        if (data) {
          debug("getChunk() found chunk %o in cache, returning", chunkIdx);
          accept(data);
        } else {
          if (!this.requestedChunks[chunkIdx]) {
            debug("getChunk() requesting chunk %o from client", chunkIdx);
            this.requestedChunks[chunkIdx] = true;
            this.socket.emit("server:request-chunk", chunkIdx);
          } else
            debug(
              "getChunk(): chunk %o has been requested, waiting for result",
              chunkIdx
            );

          if (!this.chunkWaiters[chunkIdx]) this.chunkWaiters[chunkIdx] = [];
          this.chunkWaiters[chunkIdx].push(accept);
        }
      });
    });
  }

  async deliverChunk(chunkIdx, data) {
    debug(
      "deliverChunk(): chunk %o delivered, bytes: %o",
      chunkIdx,
      data.length
    );
    delete this.requestedChunks[chunkIdx];

    await this.lock.acquire(chunkIdx, async () => {
      await cache.put(this.id + "/" + chunkIdx, data);
      for (const chunkWaiter of this.chunkWaiters[chunkIdx]) {
        chunkWaiter(data);
      }
      delete this.chunkWaiters[chunkIdx];
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
