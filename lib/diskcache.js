const uuidv4 = require("uuid").v4;
const AsyncLock = require("async-lock");
const path = require("path");
const util = require("util");
const fs = require("fs");
const rimraf = require("rimraf");
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);
const debug = require("debug")("lib:diskcache");

module.exports = class DiskCache {
  constructor(path, maxSize) {
    this.path = path;
    this.maxSize = maxSize;
    this.sizeStored = 0; // number of bytes stored in the cache

    this.mapping = {};
    this.lock = new AsyncLock();
    this.sweepInProgress = false;
    this.writeCache = {};
    this.accessSeqNo = 0; // counter used to track most recently accessed objects

    rimraf.sync(this.path);
    fs.mkdirSync(this.path);

    debug(
      "initialized diskcache at path: " +
        this.path +
        " maxsize: " +
        this.maxSize
    );
  }

  async runSweep(targetSize) {
    debug(
      "running sweep, current size: " +
        this.sizeStored +
        " target: " +
        targetSize
    );
    const objects = Object.values(this.mapping);
    objects.sort((a, b) => {
      return a.recency - b.recency;
    });
    for (const { key, id, recency, size } of objects) {
      await unlink(path.join(this.path, id));
      this.sizeStored -= size;
      delete this.mapping[key];
      if (this.sizeStored <= targetSize) {
        break;
      }
    }

    debug("size after sweep: " + this.sizeStored);
  }

  async put(key, buffer) {
    const uniqueId = uuidv4();
    if (this.mapping[key]) throw new Error("key already exists!");

    this.mapping[key] = {
      id: uniqueId,
      recency: this.accessSeqNo++,
      size: buffer.length,
      key: key,
    };
    this.writeCache[key] = buffer;
    this.sizeStored += buffer.length;

    // schedule a sweep of the disk
    if (this.sizeStored > this.maxSize && !this.sweepInProgress) {
      this.sweepInProgress = true;
      this.runSweep(this.maxSize * 0.75).then(() => {
        this.sweepInProgress = false;
      });
    }

    // flush from the write through cache as soon as possible
    (async () => {
      await writeFile(path.join(this.path, uniqueId), buffer);
      delete this.writeCache[key];
    })();
  }

  async delete(key) {
    throw new Error("pending imelementation");
  }

  async get(key) {
    if (!this.mapping[key]) return null;
    this.mapping[key].recency = this.accessSeqNo++;

    // check the write through cache
    if (this.writeCache[key]) {
      return this.writeCache[key];
    }

    // fall back to the disk
    return await readFile(path.join(this.path, this.mapping[key].id));
  }
};
