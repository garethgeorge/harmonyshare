const uuidv4 = require("uuid/v4");
const AsyncLock = require("async-lock");
const path = require("path");
const util = require("util");
const fs = require("fs");
const rimraf = require("rimraf");
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

module.exports = class DiskCache {
  constructor(path, maxSize) {
    this.path = path;
    this.maxSize = maxSize;
    this.sizeSweepThreshold = maxSize * 0.75;
    this.mapping = {};
    this.lock = new AsyncLock();

    rimraf.sync(this.path);
    fs.mkdirSync(this.path);

    this.writeCache = {};
  }

  async put(key, buffer) {
    const uniqueId = uuidv4();
    this.mapping[key] = uniqueId;
    this.writeCache[key] = buffer;

    // asynchronous write from memory to disk
    (async () => {
      await writeFile(path.join(this.path, uniqueId), buffer);
      delete this.memoryCache[key];
    })();
  }

  async get(key) {
    if (this.writeCache[key]) {
      return this.writeCache[key];
    }
    if (!this.mapping[key]) return null;
    return await readFile(path.join(this.path, this.mapping[key]));
  }
};
