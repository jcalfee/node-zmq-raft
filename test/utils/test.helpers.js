/*
 *  Copyright (c) 2016-2023 Rafał Michalski <royal@yeondir.com>
 *  License: LGPL
 */
"use strict";

const test = require('tap').test;
const crypto = require('crypto');
const raft = require('../..');
const { helpers } = raft.utils;

test('should have functions and properties', t => {
  t.type(helpers.assertConstantsDefined                , 'function');
  t.equal(helpers.assertConstantsDefined.length , 3);
  t.type(helpers.createRangeRandomizer                 , 'function');
  t.equal(helpers.createRangeRandomizer.length  , 2);
  t.type(helpers.defineConst                           , 'function');
  t.equal(helpers.defineConst.length            , 3);
  t.type(helpers.delay                                 , 'function');
  t.equal(helpers.delay.length                  , 2);
  t.type(helpers.lpad                                  , 'function');
  t.equal(helpers.lpad.length                   , 3);
  t.type(helpers.matchNothingPattern                   , RegExp);
  t.type(helpers.parsePeers                            , 'function');
  t.equal(helpers.parsePeers.length             , 2);
  t.type(helpers.regexpEscape                          , 'function');
  t.equal(helpers.regexpEscape.length           , 1);
  t.end();
});

test('assertConstantsDefined', t => {
  var o = {};
  t.equal(helpers.assertConstantsDefined(o), o);
  o = {foo: 1, bar: 2, baz: 0/0};
  t.equal(helpers.assertConstantsDefined(o, 'number'), o);
  o = {foo: 'foo', bar: '', baz: ' '};
  t.equal(helpers.assertConstantsDefined(o, 'string'), o);
  o = {foo: Symbol('foo'), bar: Symbol(), baz: Symbol.for('baz')};
  t.equal(helpers.assertConstantsDefined(o, 'symbol'), o);
  o = {foo: 1, bar: 2, baz: undefined};
  t.throws(() => helpers.assertConstantsDefined(o, 'number'));
  o = {foo: 1, bar: 2, baz: '3'};
  t.throws(() => helpers.assertConstantsDefined(o, 'number'));
  o = {foo: 'foo', bar: '', baz: null};
  t.throws(() => helpers.assertConstantsDefined(o, 'string'));
  o = {foo: Symbol('foo'), bar: Symbol(), baz: 'baz'};
  t.throws(() => helpers.assertConstantsDefined(o, 'symbol'));
  t.end();
});

test('createRangeRandomizer', t => {
  t.throws(() => helpers.createRangeRandomizer(), new TypeError('arguments must be numbers'));
  t.type(helpers.createRangeRandomizer(0,0), 'function');
  t.equal(helpers.createRangeRandomizer(0,0).length, 0);
  var fun = helpers.createRangeRandomizer(1, 10);
  var res = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0};
  for(var val, i = 10000; i-- > 0; res[val]++) {
    val = fun();
    t.type(val, 'number');
    t.ok(isFinite(val));
    t.ok(val >= 1);
    t.ok(val <= 10);
    t.equal(val % 1, 0);
  }
  for(var n in res) {
    t.ok(res[n] / 1000 > 0.8);
    t.ok(res[n] / 1000 < 1.2);
  }
  t.end();
});

test('defineConst', t => {
  var o = {}, x = [];
  t.equal(helpers.defineConst(o, 'foo', x), x);
  t.equal(o.foo, x);
  t.throws(() => o.foo = null, TypeError);
  t.equal(o.foo, x);
  t.throws(() => { delete o.foo; }, TypeError);
  t.equal(o.foo, x);
  t.throws(() => helpers.defineConst(o, 'foo', 0), TypeError);
  t.equal(o.foo, x);
  t.end();
});

test('delay', t => {
  t.plan(5);
  var start = Date.now();
  return Promise.all([
    helpers.delay(25).then(res => {
      var time = Date.now() - start;
      t.ok(time >= 24, 'was: ' + time);
      t.equal(res, void 0);
    }),
    helpers.delay(35, Symbol.for('foo')).then(res => {
      var time = Date.now() - start;
      t.ok(time >= 34, 'was: ' + time);
      t.equal(res, Symbol.for('foo'));
    }),
  ]).then(() => t.ok(true)).catch(t.throws);
});

test('lpad', t => {
  t.equal(helpers.lpad(''), '');
  t.equal(helpers.lpad('foo'), 'foo');
  t.equal(helpers.lpad('foo', 1), 'foo');
  t.equal(helpers.lpad('foo', 3), 'foo');
  t.equal(helpers.lpad('foo', 4), ' foo');
  t.equal(helpers.lpad('foo', 10), '       foo');
  t.equal(helpers.lpad('foo', 10, '='), '=======foo');
  t.equal(helpers.lpad('foo', 10, '*+'), '*+*+*+*foo');
  t.equal(helpers.lpad('', 10, '*+'), '*+*+*+*+*+');
  t.end();
});

test('matchNothingPattern', t => {
  t.equal(helpers.matchNothingPattern.test(), false);
  t.equal(helpers.matchNothingPattern.test(null), false);
  t.equal(helpers.matchNothingPattern.test([]), false);
  t.equal(helpers.matchNothingPattern.test({}), false);
  t.equal(helpers.matchNothingPattern.test(0), false);
  t.equal(helpers.matchNothingPattern.test(1), false);
  t.equal(helpers.matchNothingPattern.test(true), false);
  t.equal(helpers.matchNothingPattern.test(false), false);
  t.equal(helpers.matchNothingPattern.test(' '), false);
  t.equal(helpers.matchNothingPattern.test('\x00'), false);
  t.equal(helpers.matchNothingPattern.test('foo'), false);
  t.equal(helpers.matchNothingPattern.test(crypto.randomBytes(10000).toString()), false);
  t.end();
});

test('validatePeerUrlFormat', t => {
  t.throws(() => helpers.validatePeerUrlFormat(), new Error("peer url must be a non empty string"));
  t.throws(() => helpers.validatePeerUrlFormat(''), new Error("peer url must be a non empty string"));
  t.throws(() => helpers.validatePeerUrlFormat('foo'), new Error("peer url protocol must be tcp:"));
  t.throws(() => helpers.validatePeerUrlFormat('udp:///'), new Error("peer url protocol must be tcp:"));
  t.throws(() => helpers.validatePeerUrlFormat('http:///'), new Error("peer url protocol must be tcp:"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://foo:bar@127.0.0.1'), new Error("peer url must have no auth"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://[::]:4087/'), new Error("peer url must have no path"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1/'), new Error("peer url must have no path"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1:4087/'), new Error("peer url must have no path"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1?'), new Error("peer url must have no path"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1:4087?'), new Error("peer url must have no path"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1/?'), new Error("peer url must have no path"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1:4087/?'), new Error("peer url must have no path"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1#'), new Error("peer url must have no hash"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1:1234#'), new Error("peer url must have no hash"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1'), new Error("peer url port must be in range 1-65535"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1:0'), new Error("peer url port must be in range 1-65535"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1:65536'), new Error("peer url port must be in range 1-65535"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://127.0.0.1:100000'), new Error("peer url port must be in range 1-65535"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://0.0.0.0:4087'), new Error("peer url must not be a placeholder address"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://[::]:4087'), new Error("peer url must not be a placeholder address"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://foo:4087'), new Error("peer url must have a valid ip address in hostname"));
  t.throws(() => helpers.validatePeerUrlFormat('tcp://foo.bar:4087'), new Error("peer url must have a valid ip address in hostname"));

  t.type(helpers.validatePeerUrlFormat('tcp://127.0.0.1:4087'), Object);
  t.equal(helpers.validatePeerUrlFormat('tcp://127.0.0.1:4087').href, 'tcp://127.0.0.1:4087');

  t.end();
});

test('parsePeers', t => {
  var map;
  t.throws(() => helpers.parsePeers(), TypeError);
  t.throws(() => helpers.parsePeers({}), TypeError);
  t.throws(() => helpers.parsePeers(0), TypeError);
  t.throws(() => helpers.parsePeers(''), TypeError);
  t.throws(() => helpers.parsePeers(['']), Error);
  t.throws(() => helpers.parsePeers([]), new Error("at least one peer must be defined in a cluster"));
  t.throws(() => helpers.parsePeers(['foo']), Error);
  t.throws(() => helpers.parsePeers([['']]), Error);
  t.throws(() => helpers.parsePeers([['','x']]), Error);
  t.throws(() => helpers.parsePeers([['x','']]), Error);
  t.throws(() => helpers.parsePeers([['x','y']]), Error);
  t.throws(() => helpers.parsePeers([{id:''}]), Error);
  t.throws(() => helpers.parsePeers([{url:''}]), Error);
  t.throws(() => helpers.parsePeers([{id: 'foo', url:''}]), Error);
  t.throws(() => helpers.parsePeers([{id: 'foo', url:'blah'}]), Error);
  t.throws(() => helpers.parsePeers(['tcp://127.0.0.1:4087', 'tcp://127.0.0.1:4087']), Error);
  t.throws(() => helpers.parsePeers([['1', 'tcp://127.0.0.1:4087'], ['2', 'tcp://127.0.0.1:4087']]), Error);
  t.throws(() => helpers.parsePeers([['1', 'tcp://127.0.0.1:4087'], ['1', 'tcp://127.0.0.1:4187']]), Error);
  t.type(map = helpers.parsePeers(['tcp://127.0.0.1:4087']), Map);
  t.equal(map.size, 1);
  t.throws(() => helpers.parsePeers([], []), TypeError);
  t.throws(() => helpers.parsePeers([], {}), TypeError);

  t.type(map = helpers.parsePeers([['tcp://127.0.0.1:4087']]), Map);
  t.equal(map.size, 1);
  t.same(Array.from(map), [['tcp://127.0.0.1:4087', 'tcp://127.0.0.1:4087']]);

  t.type(map = helpers.parsePeers(['tcp://127.0.0.1:4087', 'tcp://127.0.0.1:4187', 'tcp://127.0.0.1:4287']), Map);
  t.equal(map.size, 3);
  t.same(Array.from(map), [['tcp://127.0.0.1:4087', 'tcp://127.0.0.1:4087'], ['tcp://127.0.0.1:4187', 'tcp://127.0.0.1:4187'], ['tcp://127.0.0.1:4287', 'tcp://127.0.0.1:4287']]);

  t.type(map = helpers.parsePeers([['tcp://127.0.0.1:4087'], ['tcp://127.0.0.1:4187'], ['tcp://127.0.0.1:4287']]), Map);
  t.equal(map.size, 3);
  t.same(Array.from(map), [['tcp://127.0.0.1:4087', 'tcp://127.0.0.1:4087'], ['tcp://127.0.0.1:4187', 'tcp://127.0.0.1:4187'], ['tcp://127.0.0.1:4287', 'tcp://127.0.0.1:4287']]);

  t.type(map = helpers.parsePeers([{id:'tcp://127.0.0.1:4087'}, {id:'tcp://127.0.0.1:4187'}, {id:'tcp://127.0.0.1:4287'}]), Map);
  t.equal(map.size, 3);
  t.same(Array.from(map), [['tcp://127.0.0.1:4087', 'tcp://127.0.0.1:4087'], ['tcp://127.0.0.1:4187', 'tcp://127.0.0.1:4187'], ['tcp://127.0.0.1:4287', 'tcp://127.0.0.1:4287']]);

  t.type(map = helpers.parsePeers([{url:'tcp://127.0.0.1:4087'}, {url:'tcp://127.0.0.1:4187'}, {url:'tcp://127.0.0.1:4287'}]), Map);
  t.equal(map.size, 3);
  t.same(Array.from(map), [['tcp://127.0.0.1:4087', 'tcp://127.0.0.1:4087'], ['tcp://127.0.0.1:4187', 'tcp://127.0.0.1:4187'], ['tcp://127.0.0.1:4287', 'tcp://127.0.0.1:4287']]);

  t.type(map = helpers.parsePeers([['01','tcp://127.0.0.1:4087'], ['02', 'tcp://127.0.0.1:4187'], ['03', 'tcp://127.0.0.1:4287']]), Map);
  t.equal(map.size, 3);
  t.same(Array.from(map), [['01','tcp://127.0.0.1:4087'], ['02', 'tcp://127.0.0.1:4187'], ['03', 'tcp://127.0.0.1:4287']]);

  t.type(map = helpers.parsePeers([{id:'01',url:'tcp://127.0.0.1:4087'}, {id:'02', url:'tcp://127.0.0.1:4187'}, {id:'03', url:'tcp://127.0.0.1:4287'}]), Map);
  t.equal(map.size, 3);
  t.same(Array.from(map), [['01','tcp://127.0.0.1:4087'], ['02', 'tcp://127.0.0.1:4187'], ['03', 'tcp://127.0.0.1:4287']]);

  map = new Map([['1', 'tcp://127.0.0.1:4087'], ['2', 'tcp://127.0.0.1:4187']]);
  t.type(helpers.parsePeers([['1', 'tcp://127.0.0.1:4087']], map), Map);
  t.type(helpers.parsePeers([['2', 'tcp://127.0.0.1:4187'], ['3', 'tcp://127.0.0.1:4287']], map), Map);
  t.throws(() => helpers.parsePeers([['1', 'tcp://127.0.0.1:4187']], map), Error);
  t.throws(() => helpers.parsePeers([['3', 'tcp://127.0.0.1:4087']], map), Error);
  t.end();
});

test('regexpEscape', t => {
  t.equal(helpers.regexpEscape(''), '');
  t.ok(new RegExp(helpers.regexpEscape('')).test(''));
  t.equal(helpers.regexpEscape('foo'), 'foo');
  t.ok(new RegExp(helpers.regexpEscape('foo')).test('foo'));
  t.equal(helpers.regexpEscape('*'), '\\*');
  t.ok(new RegExp(helpers.regexpEscape('*')).test('*'));
  t.ok(new RegExp(helpers.regexpEscape('-/\\^$*+?.()|[]{}')).test('-/\\^$*+?.()|[]{}'));
  t.end();
});

test('isNonEmptyString', t => {
  t.equal(helpers.isNonEmptyString(), false);
  t.equal(helpers.isNonEmptyString(''), false);
  t.equal(helpers.isNonEmptyString([]), false);
  t.equal(helpers.isNonEmptyString(0), false);
  t.equal(helpers.isNonEmptyString(1), false);
  t.equal(helpers.isNonEmptyString({}), false);
  t.equal(helpers.isNonEmptyString(new Date), false);
  t.equal(helpers.isNonEmptyString(Date), false);
  t.equal(helpers.isNonEmptyString(' '), true);
  t.equal(helpers.isNonEmptyString('1'), true);
  t.equal(helpers.isNonEmptyString('0'), true);
  t.equal(helpers.isNonEmptyString('foo'), true);
  t.end();
});

test('majorityOf', t => {
  t.equal(helpers.majorityOf(0), 1);
  t.equal(helpers.majorityOf(1), 1);
  t.equal(helpers.majorityOf(2), 2);
  t.equal(helpers.majorityOf(3), 2);
  t.equal(helpers.majorityOf(4), 3);
  t.equal(helpers.majorityOf(5), 3);
  t.equal(helpers.majorityOf(6), 4);
  t.equal(helpers.majorityOf(7), 4);
  t.equal(helpers.majorityOf(8), 5);
  t.equal(helpers.majorityOf(9), 5);
  t.equal(helpers.majorityOf(10), 6);
  t.end();
});

test("isMap", function(t) {
  t.equal(helpers.isMap({}),                              false);
  t.equal(helpers.isMap([]),                              false);
  t.equal(helpers.isMap(new Date),                        false);
  t.equal(helpers.isMap(/regexp/),                        false);
  t.equal(helpers.isMap(new String('asd')),               false);
  t.equal(helpers.isMap(new Number(42)),                  false);
  t.equal(helpers.isMap(new Boolean(false)),              false);
  t.equal(helpers.isMap(new Map()),                       true);
  t.equal(helpers.isMap(new Set()),                       false);
  t.equal(helpers.isMap(Object.create(null)),             false);
  t.equal(helpers.isMap(Object.create(Array.prototype)),  false);
  t.equal(helpers.isMap(Object.create(RegExp.prototype)), false);
  t.equal(helpers.isMap(Object.create(Date.prototype)),   false);
  t.equal(helpers.isMap(Object.create(RegExp.prototype)), false);
  t.equal(helpers.isMap(),                                false);
  t.equal(helpers.isMap(null),                            false);
  t.equal(helpers.isMap(undefined),                       false);
  t.equal(helpers.isMap(false),                           false);
  t.equal(helpers.isMap(true),                            false);
  t.equal(helpers.isMap(0),                               false);
  t.equal(helpers.isMap(42),                              false);
  t.equal(helpers.isMap(''),                              false);
  t.equal(helpers.isMap('foo'),                           false);
  t.equal(helpers.isMap(function(){}),                    false);
  t.equal(helpers.isMap(Symbol("foo")),                   false);
  t.end();
});

test('mergeMaps', t => {
  var map = new Map([[1, 2], [3, 4]]);
  t.equal(helpers.mergeMaps(map), map);
  t.equal(map.size, 2);
  t.same(Array.from(map), [[1, 2], [3, 4]]);
  t.equal(helpers.mergeMaps(map, new Map([[3, 4], [5, 6]])), map);
  t.equal(map.size, 3);
  t.same(Array.from(map), [[1, 2], [3, 4], [5, 6]]);
  t.equal(helpers.mergeMaps(map, new Map([[3, 4], [5, 6]]), new Map([[7, 8], [3, 44]])), map);
  t.equal(map.size, 4);
  t.same(Array.from(map), [[1, 2], [3, 44], [5, 6], [7, 8]]);
  t.end();
});

test('createOptionsFactory', t => {
  const defaultOpts = {foo: {bar: {baz: 42}}};
  var createOptions = helpers.createOptionsFactory(defaultOpts);
  var options = createOptions();
  t.same(options, defaultOpts);
  t.not(options, defaultOpts);
  t.not(options.foo, defaultOpts.foo);
  t.not(options.foo.bar, defaultOpts.foo.bar);
  t.same(createOptions({foo: {}}), defaultOpts);
  t.throws(() => createOptions({foo: 1}), new TypeError('Expected a namespace: "foo"'));
  t.same(createOptions({foo: {bar: {}}}), defaultOpts);
  t.throws(() => createOptions({foo: {bar: ''}}), new TypeError('Expected a namespace: "bar"'));
  options = {xxx: 123, foo: {bar: {baz: -1}}};
  t.not(createOptions(options), options);
  t.not(createOptions(options).foo, options.foo);
  t.not(createOptions(options).foo.bar, options.foo.bar);
  t.same(createOptions(options), {xxx: 123, foo: {bar: {baz: -1}}});
  t.same(options, {xxx: 123, foo: {bar: {baz: -1}}});
  t.end();
});

test('validateIntegerOption', t => {
  var options = {foo: '1', bar: '-1'};
  t.equal(helpers.validateIntegerOption(options, 'foo', 1, 1), 1);
  t.equal(helpers.validateIntegerOption(options, 'bar', -1, 0), -1);
  t.equal(helpers.validateIntegerOption({foo: 42}, 'foo', 0, 100), 42);
  t.throws(() => helpers.validateIntegerOption({}, 'foo'), new TypeError("options.foo must be an integer value"));
  t.throws(() => helpers.validateIntegerOption({foo: 'foo'}, 'foo'), new TypeError("options.foo must be an integer value"));
  t.throws(() => helpers.validateIntegerOption({foo: '100'}, 'foo', 101), new TypeError("options.foo must be >= 101"));
  t.throws(() => helpers.validateIntegerOption({foo: '100'}, 'foo', null, 99), new TypeError("options.foo must be <= 99"));
  t.end();
});

test('isPowerOfTwo32', t => {
  t.equal(helpers.isPowerOfTwo32(), false);
  t.equal(helpers.isPowerOfTwo32([]), false);
  t.equal(helpers.isPowerOfTwo32({}), false);
  t.equal(helpers.isPowerOfTwo32(null), false);
  t.equal(helpers.isPowerOfTwo32(0), false);
  t.equal(helpers.isPowerOfTwo32(1), true);
  t.equal(helpers.isPowerOfTwo32(-1), false);
  var res = [];
  for (let v = -65536; v <= 65536; ++v) {
    if (helpers.isPowerOfTwo32(v)) {
      res.push(v);
    }
  }
  t.strictSame(res, [1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536]);
  t.equal(helpers.isPowerOfTwo32(16777215), false);
  t.equal(helpers.isPowerOfTwo32(16777216), true);
  t.equal(helpers.isPowerOfTwo32(16777217), false);
  t.equal(helpers.isPowerOfTwo32(2**31+1), false);
  t.equal(helpers.isPowerOfTwo32(2**31), true);
  t.equal(helpers.isPowerOfTwo32(2**31-1), false);
  t.equal(helpers.isPowerOfTwo32(2**32), true);
  t.equal(helpers.isPowerOfTwo32(2**32-1), false);
  t.end();
});

test('nextPowerOfTwo32', t => {
  var res = new Map();
  t.equal(helpers.nextPowerOfTwo32(), 0);
  t.equal(helpers.nextPowerOfTwo32([]), 0);
  t.equal(helpers.nextPowerOfTwo32({}), 0);
  t.equal(helpers.nextPowerOfTwo32(null), 0);
  t.equal(helpers.nextPowerOfTwo32(0), 0);
  t.equal(helpers.nextPowerOfTwo32(-1), 0);
  t.equal(helpers.nextPowerOfTwo32(1), 1);
  t.equal(helpers.nextPowerOfTwo32(2), 2);
  t.equal(helpers.nextPowerOfTwo32(3), 4);
  t.equal(helpers.nextPowerOfTwo32(4), 4);
  for (let x = -65536; x <= 65536; ++x) {
    let y = helpers.nextPowerOfTwo32(x);
    res.set(y, (res.get(y)||0) + 1);
  }
  t.strictSame(Array.from(res.keys()), [0,1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536]);
  t.strictSame(Array.from(res.values()), [65537,1,1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768]);
  t.equal(helpers.nextPowerOfTwo32(2**31+1), 0);
  t.equal(helpers.nextPowerOfTwo32(2**31), 0x80000000);
  t.equal(helpers.nextPowerOfTwo32(2**31-1), 0x80000000);
  t.equal(helpers.nextPowerOfTwo32(2**32), 0);
  t.equal(helpers.nextPowerOfTwo32(2**32-1), 0);
  t.end();
});
