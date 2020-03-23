const uuidv4 = require("uuid/v4");
const AsyncLock = require("async-lock");
const path = require("path");
const util = require("util");
const fs = require("fs");

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

module.exports = class DiskCache {
  constructor(path, maxSize) {
    this.path = path;
    this.maxSize = maxSize;
    this.mapping = {};
    this.lock = new AsyncLock();

    try {
      rimraf.sync(this.path);
    } catch (e) {};
    fs.mkdirSync(this.path);
  }

  async put(key, value) {
    await this.lock.acquire(key, async () => {
      const uniqueId = uuidv4();
      this.mapping[key] = uniqueId;
      await writeFile(path.join(this.path, uniqueId), value);
    });
  }

  async get(key) {
    return await this.lock.acquire(key, async () => {
      if (!this.mapping[key])
        throw new Error("key " + key + " does not exist in DiskCache");
      
      return readFile(path.join(this.path, this.mapping[key]));
    });
  }
}