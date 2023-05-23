/* 
 *  Copyright (c) 2016-2018 Rafał Michalski <royal@yeondir.com>
 */
"use strict";

/*

  client = new ZmqRaftSubscriber('tcp://127.0.0.1:1234')

  client.on('data' => (snapshotChunkOrLogEntry) => {
  
  })
  client.write(updateRequest)

  db.stream.pipe(client).pipe(db.stream);

*/

const isArray  = Array.isArray
    , isBuffer = Buffer.isBuffer
    , now      = Date.now;

const assert = require('assert');

const { Duplex } = require('stream');

const { ZMQ_LINGER } = require('zeromq');
const { ZmqSocket } = require('../utils/zmqsocket');

const { assertConstantsDefined, delay, parsePeers } = require('../utils/helpers');

const { bufferToLogEntry, UpdateRequest: { isUpdateRequest } } = require('../common/log_entry');

const { BROADCAST_HEARTBEAT_INTERVAL
      , RE_STATUS_SNAPSHOT
      } = require('../common/constants');

assertConstantsDefined({
  BROADCAST_HEARTBEAT_INTERVAL
, RE_STATUS_SNAPSHOT
}, 'number');

const DEFAULT_BROADCAST_TIMEOUT = BROADCAST_HEARTBEAT_INTERVAL * 2;
const BROADCAST_TIMEOUT_MIN = 100;

const REQUEST_URL_MSG_TYPE = '*';

const requestUrlTypeBuf  = Buffer.from(REQUEST_URL_MSG_TYPE);

const ZmqRaftClient = require('../client/zmq_raft_client');

const TimeoutError = ZmqRaftClient.TimeoutError;

const secretBuf$ = Symbol('secretBuf');

const { createFramesProtocol } = require('../protocol');

const stateBroadcastProtocol = createFramesProtocol('StateBroadcast');

const debug = require('debug')('zmq-raft:subscriber');

function MissingEntriesError(message) {
  Error.captureStackTrace(this, TimeoutError);
  this.name = 'TimeoutError';
  this.message = message || 'some entries are missing';
}

MissingEntriesError.prototype = Object.create(Error.prototype);
MissingEntriesError.prototype.constructor = MissingEntriesError;
MissingEntriesError.prototype.isMissingEntries = true;

/**
 * A ZmqRaftSubscriber class implements a stream.Duplex interface for reading and updating
 * log entries from the ZmqRaft peer cluster with a BroadcastStateMachine via an underlying
 * ZmqRaftClient and a zeromq SUB socket.
 *
 * The messages received by the Readable part of the stream are instances of either
 * common.LogEntry or common.SnapshotChunk.
 *
 * The Writable part of the stream accepts instances of common.LogEntry.UpdateRequest.
 * 
 * @property lastLogIndex {number} - keeps track of the last received log index
 * @property lastUpdateLogIndex {number} - keeps track of the last update commit index
**/
class ZmqRaftSubscriber extends Duplex {
  /**
   * Create ZmqRaftSubscriber
   *
   * `options` may be one of:
   *
   * - `url` {String}: A seed url to fetch peer urls from via a Request Config RPC.
   * - `urls` {Array}: An array of seed urls to fetch peers from via a Request Config RPC.
   * - `peers` {Array}: An array of established zmq raft server descriptors;
   *                    `peers` has precedence over `urls` and if provided the peer list
   *                    is not being fetched via Request Config RPC.
   * - `secret` {String|Buffer}: A cluster identifying string which is sent and verified against
   *                             in each message.
   * - `timeout` {number}: A time in milliseconds after which we consider a server peer as unresponsive.
   * - `sockopts` {Object}: Specify zeromq socket options as an object e.g.: `{ZMQ_IPV4ONLY: true}`.
   * - `highwatermark` {number}: A shortcut to specify `ZMQ_SNDHWM` socket option for an underlying
   *                   zeromq DEALER socket; this affects how many messages are queued per server
   *                   so if one of the peers goes down this many messages are possibly lost;
   *                   setting it prevents spamming a peer with expired messages when temporary
   *                   network partition occures (default: 2).
   * - `serverElectionGraceDelay` {number}: A delay in milliseconds to wait for the Raft peers
   *                                     to elect a new leader before retrying (default: 300).
   * - `duplex` {Object}: Super class initialization options
   *                      (stream.Duplex, e.g. writableHighWaterMark, readableHighWaterMark).
   * - `readable` {Object}: RequestEntriesStream super class initialization options
   *                        (stream.Readable, e.g. highWaterMark).
   * - `lastIndex` {number}: An index of the last entry in the local state machine:
   *                         entries with indexes starting from lastIndex + 1 will be retrieved.
   * - `broadcastTimeout` {number}: Milliseconds before the broadcast server is considered unresponsive
   *                                (default: 1 second).
   *
   * @param {string|Array} [urls]
   * @param {Object} [options]
   * @return {ZmqRaftSubscriber}
  **/
  constructor(urls, options) {
    if (urls && !isArray(urls) && 'object' === typeof urls) {
      options = urls, urls = undefined;
    }
    options || (options = {});
    if (!options && 'object' !== typeof options) {
      throw TypeError('ZmqRaftSubscriber: options must be an object');
    }

    var broadcastTimeoutMs = (options.broadcastTimeout|0) || DEFAULT_BROADCAST_TIMEOUT;
    if (broadcastTimeoutMs < BROADCAST_TIMEOUT_MIN) {
      broadcastTimeoutMs = BROADCAST_TIMEOUT_MIN;
    }

    const client = new ZmqRaftClient(urls, Object.assign({lazy: true}, options));

    super(Object.assign({readableHighWaterMark: 4}, options.duplex, {objectMode: true}));

    this.entriesStreamOptions = Object.assign({highWaterMark: 4}, options.readable, {timeout: 0});

    this.broadcastTimeoutMs = broadcastTimeoutMs;

    debug('broadcast timeout: %s ms.', broadcastTimeoutMs);

    this._read = (/* size */) => {
      /* lazy initialize */
      delete this._read;
      delete this._write;
      sub.subscribe(this[secretBuf$]);
      this._subscriberTimeout = true;
      this._requestPublisherUrl().catch(err => this.emit('error', err));
    };

    this._write = (updateRequest, encoding, callback) => {
      delete this._write;
      this._requestPublisherUrl().catch(err => this.emit('error', err));
      this._write(updateRequest, encoding, callback);
    };

    this.client = client;

    this[secretBuf$] = Buffer.from(options.secret || '');

    this.url = null;

    var sub = this.sub = new ZmqSocket('sub');
    /* makes sure socket is really closed when close() is called */
    sub.setsockopt(ZMQ_LINGER, 0);

    this._listener = stateBroadcastProtocol.createSubMessageListener(sub, this._handleBroadcast, this);

    var lastIndex = options.lastIndex;

    if (lastIndex === undefined) lastIndex = 0;
    else if (!Number.isFinite(lastIndex) || lastIndex < 0 || lastIndex % 1 !== 0) {
      throw new Error("ZmqRaftSubscriber: lastIndex must be an unsigned integer");
    }

    this.lastLogIndex = lastIndex;
    this.lastUpdateLogIndex = lastIndex;
    this.ahead = [];
    this.isFresh = null;
    this._pendingMissing = null;
    this._pendingRpcStream = null;
    this._pendingRequestPubUrl = null;
    this._subscriberTimeout = undefined;
  }

  close() {
    const sub = this.sub;
    if (!sub) return this;
    this.sub = null;
    clearTimeout(this._subscriberTimeout);
    this._subscriberTimeout = undefined;
    sub.unsubscribe(this[secretBuf$]);
    if (this.url !== null) {
      debug('socket.disconnect: %s', this.url)
      sub.disconnect(this.url);
    }
    sub.removeListener('frames', this._listener);
    sub.close();
    this.client.close();
    this.client = null;
    debug('subscriber closed');
    return this;
  }

  toString() {
    var url = this.url;
    return `[object ZmqRaftSubscriber{${(url || '-none-')}}]`;
  }

  connect(url) {
    const sub = this.sub
        , old = this.url;

    if (isBuffer(url)) url = url.toString();

    if (old) {
      debug('subscriber.disconnect: %s', old);
      sub.disconnect(old);
    }

    if (url) {
      if ('string' !== typeof url) {
        throw new TypeError("subscriber.connect: url must be a string or a buffer");
      }
      this.url = url;
      debug('subscriber.connect: %s', url);
      sub.connect(url);
    }
    else {
      this.url = null;
    }
    return this;
  }

  _requestPublisherUrl() {
    if (this._pendingRequestPubUrl !== null) return this._pendingRequestPubUrl;

    debug('requesting publisher url');
    const client = this.client;

    var request = () => {
      return client.requestConfig().then(() => {
        if (client.leaderId !== null) {
          /* we have a leader, ask for state machine publisher url */
          return client.request([requestUrlTypeBuf, this[secretBuf$]])
          .then(([url]) => {
            this.connect(url);
            if (url === undefined) {
              debug('missing publisher url, retrying request');
              return request();
            }
            else {
              this._refreshSubTimeout();
              /* success */
              this._pendingRequestPubUrl = null;
              return this.url;
            }
          })
          .catch(err => {
            if (err.isTimeout) {
              debug('timeout occured trying to find another server');
              client.setLeader(null);
              return request();
            }
            else throw err;
          });
        }
        else {
          debug('no leader, trying again later');
          return delay(client.serverElectionGraceDelay).then(() => request());
        }
      });
    };

    return this._pendingRequestPubUrl = request().catch(err => {
      this._pendingRequestPubUrl = null;
      throw err;
    });
  }

  _handleBroadcast(args) {
    const [secret, term, lastLogIndex] = args.splice(0, 3);
    const entries = args;
    if (!this[secretBuf$].equals(secret)) {
      return this.emit('error', new Error('ZmqRaftSubscriber: broadcast auth fail'));
    }
    try {
      if (!this._appendEntries(entries, lastLogIndex)) {
        this._pauseSubscriber();
      }
      if (!this.isFresh) {
        this.isFresh = true;
        this.emit('fresh');
      }
    } catch(err) {
      if (err.isMissingEntries) {
        debug('broadcast missing: (%s) %s < %s', entries.length, this.lastLogIndex, lastLogIndex);
        const ahead = this.ahead;
        if (entries.length !== 0) {
          ahead.push({lastLogIndex: lastLogIndex, entries: entries});
        }
        this._requestMissingEntries(lastLogIndex - entries.length - this.lastLogIndex);
      }
      else throw err;
    }
    this._refreshSubTimeout();
  }

  _flushAhead() {
    const ahead = this.ahead;
    while(ahead.length !== 0) {
      const {lastLogIndex, entries} = ahead[0];
      try {
        if (!this._appendEntries(entries, lastLogIndex)) {
          this._pauseSubscriber();
        }
        ahead.shift();
      } catch(err) {
        if (err.isMissingEntries) {
          /* gap in ahead */
          return this._requestMissingEntries(lastLogIndex - entries.length - this.lastLogIndex);
        }
        else throw err;
      }
    }
  }

  /*
    throws MissingEntriesError if provided entries can't be applied
    returns false when backpressure is needed:
    https://nodejs.org/dist/latest-v6.x/docs/api/stream.html#stream_readable_push_chunk_encoding */
  _appendEntries(entries, lastLogIndex) {
    const entryCount = entries.length;
    const gapSize = lastLogIndex - this.lastLogIndex;
    if (gapSize > entryCount) {
      throw new MissingEntriesError();
    }
    var res = true;
    if (lastLogIndex > this.lastLogIndex) {
      const firstLogIndex = lastLogIndex - entryCount + 1;
      debug('appending entries: (%s) indexes: %s - %s', entryCount, firstLogIndex, lastLogIndex);
      for(let i = entryCount - gapSize; i < entryCount; ++i) {
        let entry = bufferToLogEntry(entries[i], firstLogIndex + i);
        res = this.push(entry);
      }
      this.lastLogIndex = lastLogIndex;
    }
    return res;
  }

  _pauseSubscriber() {
    if (this._subscriberTimeout) {
      clearTimeout(this._subscriberTimeout);
      debug('backpressured, unsubscribing');
      const sub = this.sub;
      sub.pause();
      sub.unsubscribe(this[secretBuf$]);
      this._subscriberTimeout = null;
    }
  }

  _refreshSubTimeout() {
    if (this._subscriberTimeout) {
      clearTimeout(this._subscriberTimeout);
      if (this.sub === null) return;
      this._subscriberTimeout = setTimeout(() => {
        debug('broadcast timeout');
        this.emit('timeout');
        this._requestPublisherUrl().catch(err => this.emit('error', err));
      }, this.broadcastTimeoutMs);
    }
  }

  _requestMissingEntries(count) {
    assert(count > 0);

    if (this._pendingMissing !== null) return this._pendingMissing;

    if (this._subscriberTimeout === null) return Promise.resolve();

    this.isFresh = false;
    this.emit('stale', count);

    return this._pendingMissing = new Promise((resolve, reject) => {
      var options = this.entriesStreamOptions;
      options.count = count;
      var rpcstream = this.client.requestEntriesStream(this.lastLogIndex, options);
      rpcstream.on('data', chunk => {
        var logIndex = chunk.logIndex;
        if (logIndex > this.lastLogIndex) {
          if (!this.push(chunk)) {
            rpcstream.pause();
            this._pendingRpcStream = rpcstream;
            this._pauseSubscriber();
          }
          if (chunk.isLogEntry || chunk.isLastChunk) {
            this.lastLogIndex = logIndex;
          }
        }
      })
      .on('end', () => {
        this._pendingMissing = this._pendingRpcStream = rpcstream = null;
        resolve(this._flushAhead());
      })
      .once('error', err => {
        this._pendingMissing = this._pendingRpcStream = null;
        if (err.isOutOfOrder) {
          debug(err.message);
          resolve(this._flushAhead());
        }
        else this.emit('error', err);
      });
    });
  }

  /* Readable */

  _read(/* size */) {
    if (this._subscriberTimeout === null) {
      debug('resuming streaming - ahead: %s lastLogIndex: %s', this.ahead.length, this.lastLogIndex);
      const sub = this.sub;
      sub.resume();
      sub.subscribe(this[secretBuf$]);
      this._subscriberTimeout = true;
      this._refreshSubTimeout();
    }
    if (this._pendingRpcStream) {
      debug('resuming missing entries streaming');
      this._pendingRpcStream.resume();
      this._pendingRpcStream = null;
    }
  }

  /* Writable */

  _write(updateRequest, encoding, callback) {
    if (!isUpdateRequest(updateRequest)) {
      return callback(new TypeError("updateRequest must be a buffer with requestId property"));
    }

    this.client.requestUpdate(updateRequest.requestId, updateRequest).then(index => {
      if (index > this.lastUpdateLogIndex) {
        this.lastUpdateLogIndex = index;
      }
      debug('written index: %s', index);
      callback();
    }, callback);
  }

  /* all buffered updates are being sent at once to speed up commit syncing
     usually the updates will be accepted in the same order but there is no guarantee
     the commit order will be retained once we hit connection problems
     if this is an important issue, initialize subscriber with options:

        {duplex: {writableHighWaterMark: 1}}

      and pay attention to value returned by `writable.write` or use pipe API
  */
  _writev(requests, callback) {
    var client = this.client
      , updateRequest
      , promises = [];

    try {
      for(var i = 0, len = requests.length; i < len; ++i) {
        updateRequest = requests[i].chunk;
        if (!isUpdateRequest(updateRequest)) {
          throw new TypeError("updateRequest must be a buffer with requestId property");
        }
        let pos = promises.push(
          client.requestUpdate(updateRequest.requestId, updateRequest)
                .then(index => {
                  if (index > this.lastUpdateLogIndex) {
                    this.lastUpdateLogIndex = index;
                  }
                  debug('written index: %d (%d of %d)', index, pos, len)
                })
        );
      }
    } catch(err) {
      promises.push(Promise.reject(err));
    }

    Promise.all(promises).then(() => callback(), callback);
  }

}

ZmqRaftSubscriber.ZmqRaftSubscriber = ZmqRaftSubscriber;
module.exports = exports = ZmqRaftSubscriber;
