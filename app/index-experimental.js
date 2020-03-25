const app = require("express")();
const fs = require("fs");
const parseRange = require("range-parser");
const util = require("util");
const path = require("path");
const io = require("socket.io")(app);

const awaitEvent = async (emitter, event) => {
  return new Promise((accept) => {
    emitter.once(event, accept);
  });
};

app.get("/share/:file", async (req, res) => {
  console.log(req.headers);
  const filePath = path.join("media", req.params.file);
  const stats = await util.promisify(fs.stat)(filePath);

  let rangeStart = 0;
  let rangeStop = stats.size;
  if (req.headers.range) {
    const range = parseRange(stats.size, req.headers.range);
    if (range.length > 0) {
      console.log("DETECTED A RANGE HEADER PRESENT", JSON.stringify(range));
      rangeStart = range[0].start ? range[0].start : rangeStart;
      rangeStop = range[0].end ? range[0].end + 1 : rangeStop;
    }
  }
  console.log("determined to return ", rangeStart, " - ", rangeStop);

  const fd = await util.promisify(fs.open)(filePath, "r");
  try {
    const chunkSize = 64 * 1024;
    const buffer = Buffer.alloc(chunkSize);

    if (req.headers.range) {
      res.status(206);
    } else {
      res.status(200);
    }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Range",
      `bytes ${rangeStart}-${rangeStop - 1}/${stats.size}`
    );
    res.setHeader("Content-length", rangeStop - rangeStart);
    res.flushHeaders();

    console.log("beginning stream...", rangeStart, rangeStop);
    for (let lower = rangeStart; lower < rangeStop; lower += chunkSize) {
      const upper = Math.min(rangeStop, lower + chunkSize);
      const len = upper - lower;
      await new Promise((accept, reject) => {
        fs.read(fd, buffer, 0, len, lower, (err, bytesRead, buffer) => {
          accept();
        });
      });

      const ok = res.write(
        len == buffer.length ? buffer : buffer.slice(0, len),
        "binary"
      );
      if (!ok) {
        await awaitEvent(res, "drain");
      }
    }
    res.end();
  } finally {
    await util.promisify(fs.close)(fd);
  }
});

app.get("/media/:file", async (req, res) => {
  console.log(req.headers);
  const filePath = path.join("media", req.params.file);
  const stats = await util.promisify(fs.stat)(filePath);

  let rangeStart = 0;
  let rangeStop = stats.size;
  if (req.headers.range) {
    const range = parseRange(stats.size, req.headers.range);
    if (range.length > 0) {
      console.log("DETECTED A RANGE HEADER PRESENT", JSON.stringify(range));
      rangeStart = range[0].start ? range[0].start : rangeStart;
      rangeStop = range[0].end ? range[0].end + 1 : rangeStop;
    }
  }
  console.log("determined to return ", rangeStart, " - ", rangeStop);

  const fd = await util.promisify(fs.open)(filePath, "r");
  try {
    const chunkSize = 32 * 1024;
    const buffer = Buffer.alloc(chunkSize);

    if (req.headers.range) {
      res.status(206);
    } else {
      res.status(200);
    }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Range",
      `bytes ${rangeStart}-${rangeStop - 1}/${stats.size}`
    );
    res.setHeader("Content-length", rangeStop - rangeStart);
    res.flushHeaders();

    console.log("beginning stream...", rangeStart, rangeStop);
    for (let lower = rangeStart; lower < rangeStop; lower += chunkSize) {
      const upper = Math.min(rangeStop, lower + chunkSize);
      const len = upper - lower;
      await new Promise((accept, reject) => {
        fs.read(fd, buffer, 0, len, lower, (err, bytesRead, buffer) => {
          accept();
        });
      });

      const ok = res.write(
        len == buffer.length ? buffer : buffer.slice(0, len),
        "binary"
      );
      if (!ok) {
        await awaitEvent(res, "drain");
      }
    }
    res.end();
  } finally {
    await util.promisify(fs.close)(fd);
  }
});

io.of("/sharefile").on("connection", (socket) => {
  const chunkSize = 128 * 1024; // 128k chunk size
  let fileInfo = null;

  socket.on("client:share-file", (_fileInfo) => {
    fileInfo = _fileInfo;
  });

  socket.on("client:emit-chunk", (startRange, endRange, data) => {});
});

app.listen(3000, () => {
  console.log("listening on port 3000");
});
