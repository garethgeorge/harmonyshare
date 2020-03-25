const http = require("http");
const app = require("express")();
const parseRange = require("range-parser");
const debug = require("debug");

const FileShare = require("./model/fileshare");
const fileShares = {};

const awaitEvent = async (emitter, event) => {
  return new Promise((accept) => {
    emitter.once(event, accept);
  });
};

/*
app.get("/share/:shareId/:anything", async (req, res) => {
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
*/

app.get("/share/:shareId", async (req, res) => {
  const share = fileShares[req.params.shareId];
  if (!share) {
    res.status(404);
    return res.end("share not found");
  }
  if (!share.fileInfo) {
    return res.end("share not ready yet");
  }

  if (req.params.filename != share.fileName) {
    return res.redirect(
      "/share/" + req.params.shareId + "/" + encodeURI(share.fileName)
    );
  }
});

app.get("/share/:shareId/:filename", async (req, res) => {
  const share = fileShares[req.params.shareId];
  if (!share) {
    res.status(404);
    return res.end("share not found");
  }
  if (!share.fileInfo) {
    return res.end("share not ready yet");
  }

  const fileSize = share.fileSize;
  const fileName = share.fileName;
  if (req.params.filename != fileName) {
    return res.redirect(
      "/share/" + req.params.shareId + "/" + encodeURI(fileName)
    );
  }

  let rangeStart = 0;
  let rangeStop = fileSize;
  if (req.headers.range) {
    const range = parseRange(fileSize, req.headers.range);
    if (range.length > 0) {
      console.log("DETECTED A RANGE HEADER PRESENT", JSON.stringify(range));
      rangeStart = range[0].start ? range[0].start : rangeStart;
      rangeStop = range[0].end ? range[0].end + 1 : rangeStop;
    }
  }
  debug("determined to return ", rangeStart, " - ", rangeStop);

  const chunkSize = share.chunkSize;

  if (req.headers.range) {
    res.status(206);
  } else {
    res.status(200);
  }
  res.setHeader("Content-Type", share.mimetype);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader(
    "Content-Range",
    `bytes ${rangeStart}-${rangeStop - 1}/${fileSize}`
  );
  res.setHeader("Content-Length", rangeStop - rangeStart);
  res.flushHeaders();

  debug("beginning stream...", rangeStart, rangeStop);

  // read the first chunk
  const startChunk = Math.floor(rangeStart / chunkSize);
  let startByteIdx = rangeStart % chunkSize;
  let bytesToSend = rangeStop - rangeStart;

  debug("CHUNKS IN FILE: " + Math.ceil(fileSize / chunkSize));
  debug("BYTES TO SEND INITIAL: ", bytesToSend);

  for (let curChunkIdx = startChunk; bytesToSend > 0; ++curChunkIdx) {
    let chunk = await share.getChunk(curChunkIdx);
    const ss = startByteIdx;
    const sf = Math.min(ss + bytesToSend, chunk.length);
    debug("SS: " + ss + " SF: " + sf + " CHUNK.length: " + chunk.length);
    const toSend = chunk.slice(ss, sf);
    bytesToSend -= sf - ss;
    startByteIdx = 0;

    console.log(
      "PROCESSED CHUNK: " +
        curChunkIdx +
        " BYTES TO SEND REMAINING: " +
        bytesToSend
    );

    const ok = res.write(toSend);
    if (!ok) {
      await awaitEvent(res, "drain");
    }
  }
  res.end();
});

app.use(require("express").static("./static"));

const server = http.createServer(app);
const io = require("socket.io").listen(server);

io.of("/sharefile").on("connection", (socket) => {
  const chunkSize = 1024 * 1024; // 128k chunk size
  const newShare = new FileShare(socket, chunkSize);
  fileShares[newShare.id] = newShare;

  socket.on("disconnect", () => {
    delete fileShares[newShare.id];
  });
});

server.listen(3000, () => {
  console.log("listening on port 3000");
});
