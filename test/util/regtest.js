'use strict';

const assert = require('./assert');
const FullNode = require('../../lib/node/fullnode');
const SPVNode = require('../../lib/node/spvnode');

const {NodeClient, WalletClient} = require('bclient');

async function initFullNode(options) {
  const node = new FullNode({
    prefix: options.prefix,
    network: 'regtest',
    apiKey: 'foo',
    walletAuth: true,
    workers: true,
    listen: true,
    bip37: true,
    port: options.ports.full.p2p,
    httpPort: options.ports.full.node,
    maxOutbound: 1,
    seeds: [],
    memory: false,
    plugins: [require('../../lib/wallet/plugin')],
    env: {
      'BCOIN_WALLETHTTPPORT': (options.ports.full.wallet).toString()
    },
    logLevel: options.logLevel
  });
  await node.ensure();
  await node.open();
  await node.connect();
  return node;
}

async function initSPVNode(options) {
  const node = new SPVNode({
    prefix: options.prefix,
    network: 'regtest',
    apiKey: 'foo',
    walletAuth: true,
    workers: true,
    listen: true,
    port: options.ports.spv.p2p,
    httpPort: options.ports.spv.node,
    maxOutbound: 1,
    seeds: [],
    nodes: [`127.0.0.1:${options.ports.full.p2p}`],
    memory: false,
    plugins: [require('../../lib/wallet/plugin')],
    env: {
      'BCOIN_WALLETHTTPPORT': (options.ports.spv.wallet).toString()
    },
    logLevel: options.logLevel
  })
  await node.ensure();
  await node.open();
  await node.connect();
  await node.startSync();
  return node;
}

async function initNodeClient(options) {
  const nclient = new NodeClient({
    network: 'regtest',
    port: options.ports.node,
    apiKey: 'foo'
  });
  await nclient.open();
  return nclient;
}

async function initWalletClient(options) {
  const wclient = new WalletClient({
    network: 'regtest',
    port: options.ports.wallet,
    apiKey: 'foo'
  });
  await wclient.open();
  return wclient;
}

async function initWallet(wclient) {
  const winfo = await wclient.createWallet('test');
  assert.strictEqual(winfo.id, 'test');
  const wallet = wclient.wallet('test', winfo.token);
  await wallet.open();

  // We don't use witness here yet, as there is an activation
  // threshold before segwit can be activated.
  const info = await wallet.createAccount('blue', {witness: false});
  assert(info.initialized);
  assert.strictEqual(info.name, 'blue');
  assert.strictEqual(info.accountIndex, 1);
  assert.strictEqual(info.m, 1);
  assert.strictEqual(info.n, 1);

  return wallet;
}

async function generateBlock(nclient, coinbase) {
  return await nclient.execute('generatetoaddress', [1, coinbase]);
}

async function generateTxs(options) {
  const {wclient, count} = options;
  let addr, txid = null;

  await wclient.execute('selectwallet', ['test']);

  for (var i = 0; i < count; i++) {
    addr = await wclient.execute('getnewaddress', ['blue']);
    txid = await wclient.execute('sendtoaddress', [addr, 0.11111111]);
  }
}

async function generateInitialBlocks(options) {
  const {nclient, wclient, coinbase, genesisTime} = options;
  let {blocks} = options;

  if (!blocks)
    blocks = 100;

  const blockInterval = 600;
  const timewarp = 3200;

  let c = 0;

  // Establish baseline block interval for a median time
  for (; c < 11; c++) {
    let blocktime = genesisTime + c * blockInterval;
    await nclient.execute('setmocktime', [blocktime]);

    const blockhashes = await generateBlock(nclient, coinbase);
    const block = await nclient.execute('getblock', [blockhashes[0]]);

    assert(block.time <= blocktime + 1);
    assert(block.time >= blocktime);
  }

  // Generate time warping blocks that have time previous
  // to the previous block
  for (; c < blocks; c++) {
    let blocktime = genesisTime + c * blockInterval;
    if (c % 5)
      blocktime -= timewarp;
    await nclient.execute('setmocktime', [blocktime]);

    // If the wallet client is available and there have been
    // enough blocks for coinbase to mature, generate transactions
    // for the block. Additionally the wallet may not be in lockstep
    // sync with the chain, so it's necessary to wait a few more blocks.
    if (wclient && c > 110)
      await generateTxs({wclient: wclient, count: 50});

    const blockhashes = await generateBlock(nclient, coinbase);
    const block = await nclient.execute('getblock', [blockhashes[0]]);

    assert(block.time <= blocktime + 1);
    assert(block.time >= blocktime);
  }
}

module.exports = {
  initFullNode,
  initSPVNode,
  initNodeClient,
  initWalletClient,
  initWallet,
  generateBlock,
  generateInitialBlocks
}