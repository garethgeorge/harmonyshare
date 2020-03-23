const app = require("express")();
const fs = require("fs");
const parseRange = require("range-parser");
const util = require("util");
const path = require("path");
// https://stackoverflow.com/questions/25206141/having-trouble-streaming-response-to-client-using-expressjs

const awaitEvent = async (emitter, event) => {
  return new Promise((accept) => {
    emitter.once(event, accept);
  });
};

app.get("/:file", async (req, res) => {
  console.log("REQUEST RECEIVED!");
  console.log("REQUEST FOR FILE: " + req.params.file);
  const filePath = path.join("media", req.params.file);
  const stats = await util.promisify(fs.stat)(filePath);

  let rangeStart = 0;
  let rangeStop = stats.size;
  if (req.headers.range) {
    const range = parseRange(stats.size, req.headers.range);
    if (range.length > 0) {
      rangeStart = range[0].start || rangeStart;
      rangeStop = range[0].stop || rangeStop;
    }
  }

  res.setHeader("content-type", "video/mp4");

  const chunkSize = 128 * 1024;

  const fd = await util.promisify(fs.open)(filePath, "r");
  const buffer = Buffer.alloc(chunkSize);

  console.log("beginning stream...", fd, rangeStart, rangeStop);
  for (let lower = rangeStart; lower < rangeStop; lower += chunkSize) {
    const upper = Math.min(rangeStop, lower + chunkSize);
    await new Promise((accept, reject) => {
      fs.read(fd, buffer, 0, upper - lower, lower, (err, bytesRead, buffer) => {
        accept();
      });
    });

    const ok = res.write(buffer);
    if (!ok) {
      console.log("backpressured!");
      await awaitEvent(res, "drain");
    }
  }

  res.end();
});

app.listen(3000, () => {
  console.log("listening on port 3000");
});
