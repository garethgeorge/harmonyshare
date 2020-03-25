const http = require("http");
const app = require("express")();
const parseRange = require("range-parser");
const debug = require("debug")("app");
const express = require("express");
const morgan = require("morgan");
const bodyParser = require("body-parser");
const config = require("../config");

const FileShare = require("./model/fileshare");
const fileShares = {};

const DEFAULT_CHUNK_SIZE = config.CHUNK_SIZE_BYTES;

const awaitEvent = async (emitter, event) => {
  return new Promise((accept) => {
    emitter.once(event, accept);
  });
};

/*
  handle requests for a file share
*/

app.use(morgan("combined"));

const fileRouter = express.Router({ mergeParams: true });
app.use("/f/:shareId", fileRouter);

fileRouter.use((req, res, next) => {
  const share = fileShares[req.params.shareId];
  if (!share) {
    res.status(404);
    return res.end("share not found or no longer available");
  }
  req.share = share;

  next();
});

fileRouter.post("/api/deliverChunk/:chunkIdx", async (req, res) => {
  // check that they are authorized to deliver a chunk
  const share = req.share;
  if (req.query.secret !== share.ownerSecret) {
    debug("request to deliver chunk was not authorized");
    req.pause();
    return res.end("Not Authorized");
  }

  // // set encoding to binary and read the request
  req.setEncoding("binary");
  const buffers = [];
  let totalSize = 0;
  req.on("data", (chunk) => {
    if (totalSize > DEFAULT_CHUNK_SIZE * 1.5) {
      req.pause();
      return res.end("TOO LARGE");
    }
    totalSize += chunk.length;
    buffers.push(Buffer.from(chunk, "binary"));
  });

  await awaitEvent(req, "end");

  // great, okay we have the chunkIdx and the object, lets deliver it
  const chunkIdx = parseInt(req.params.chunkIdx);
  const object = Buffer.concat(buffers);
  debug("chunk " + chunkIdx + " was delivered, bytes: " + object.length);
  await share.deliverChunk(chunkIdx, object);
  res.end("SUCCESS");
});

fileRouter.get("/", (req, res) => {
  const share = req.share;
  return res.redirect(
    "/f/" + req.params.shareId + "/" + encodeURI(share.fileName)
  );
});

fileRouter.get("/:filename", async (req, res) => {
  const share = req.share;
  if (!share.fileInfo) {
    return res.end("share not ready yet");
  }

  debug("received request for file: " + share.fileName);

  const fileSize = share.fileSize;

  let rangeStart = 0;
  let rangeStop = fileSize;
  if (req.headers.range) {
    const range = parseRange(fileSize, req.headers.range);
    if (range.length > 0) {
      debug("range header was present on request: " + JSON.stringify(range));
      rangeStart = range[0].start ? range[0].start : rangeStart;
      rangeStop = range[0].end ? range[0].end + 1 : rangeStop;
    }
  }

  debug("determined to return byte range " + rangeStart + " - " + rangeStop);
  debug("using chunk size: " + share.chunkSize);
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

  // read the first chunk
  const startChunk = Math.floor(rangeStart / chunkSize);
  let startByteIdx = rangeStart % chunkSize;
  let bytesToSend = rangeStop - rangeStart;

  debug("chunks in file: " + Math.ceil(fileSize / chunkSize));
  debug("total bytes to send in request: ", bytesToSend);

  for (let curChunkIdx = startChunk; bytesToSend > 0; ++curChunkIdx) {
    let chunk = await share.getChunk(curChunkIdx);
    const ss = startByteIdx;
    const sf = Math.min(ss + bytesToSend, chunk.length);
    debug("SS: " + ss + " SF: " + sf + " chunk.length: " + chunk.length);
    const toSend = chunk.slice(ss, sf);
    bytesToSend -= sf - ss;
    startByteIdx = 0;
    debug("\tsent chunk: " + curChunkIdx + ", remaining bytes: " + bytesToSend);

    const ok = res.write(toSend);
    if (!ok) {
      await awaitEvent(res, "drain");
    }
  }
  res.end();
});

/*
  serve static files for the application
*/
app.use(express.static("./static"));

/*
  open to HTTP requests
*/
const server = http.createServer(app);
const io = require("socket.io").listen(server);

io.of("/sharefile").on("connection", (socket) => {
  const newShare = new FileShare(socket, config.CHUNK_SIZE_BYTES);
  fileShares[newShare.id] = newShare;

  socket.on("disconnect", () => {
    delete fileShares[newShare.id];
  });
});

server.listen(3000, () => {
  debug("listening on port 3000");
});
