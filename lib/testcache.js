const DiskCache = require("./lib/diskcache");
const diskcache = new DiskCache("./.cache");

for (let i = 0; i < 100; ++i) {
  let string = "hello world this is a test string!!!!!!!!!!!!!!!!!!!!!!!!!!!!";
  diskcache.put(i, string);
}
