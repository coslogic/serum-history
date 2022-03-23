import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js'
import { Market } from '@project-serum/serum'
import cors from 'cors'
import express from 'express'
import { Tedis, TedisPool } from 'tedis'
import { URL } from 'url'
import { decodeRecentEvents } from './events'
import { MarketConfig, Trade, TradeSide } from './interfaces'
import { RedisConfig, RedisStore, createRedisStore } from './redis'
import { resolutions, sleep } from './time'
import {
  Config,
  getMarketByBaseSymbolAndKind,
  GroupConfig,
  MangoClient,
  PerpMarketConfig,
  FillEvent,
} from '@blockworks-foundation/mango-client'
import BN from 'bn.js'
import notify from './notify'
import LRUCache from 'lru-cache'
import * as dayjs from 'dayjs'

const redisUrl = new URL(process.env.REDISCLOUD_URL || 'redis://sqid.herokuapp.com:6379')
const host = redisUrl.hostname
const port = parseInt(redisUrl.port)
let password: string | undefined
if (redisUrl.password !== '') {
  password = redisUrl.password
}

const network = 'mainnet-beta'
const clusterUrl =
  process.env.RPC_ENDPOINT_URL || 'https://ssc-dao.genesysgo.net'
const fetchInterval = process.env.INTERVAL ? parseInt(process.env.INTERVAL) : 30

console.log({ clusterUrl, fetchInterval })

const programIdV3 = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'

const nativeMarketsV3: Record<string, string> = {
  "USDT/USDC": "77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS",
  "BTC/USDC": "A8YFbxQYFVqKZaoYJLLUVcQiWP7G2MeEgW5wsAQgMvFw",
  "BTC/USDT": "C1EuT9VokAKLiW7i2ASnZUvxDoKuKkCpDDeNxAptuNe4",
  "ETH/USDC": "4tSvZvnbyzHXLMTiFonMyxZoHmFqau1XArcRCVHLZ5gX",
  "ETH/USDT": "7dLVkUfBVfCGkFhSXDCq1ukM9usathSgS716t643iFGF",
  "SRM/USDC": "ByRys5tuUWDgL73G8JBAEfkdFf8JWBzPBDHsBVQ5vbQA",
  "SRM/USDT": "AtNnsY1AyRERWJ8xCskfz38YdvruWVJQUVXgScC1iPb",
  "FIDA/USDC": "E14BKBhDWD4EuTkWj1ooZezesGxMW8LPCps4W5PuzZJo",
  "FTT/USDC": "2Pbh1CvRVku1TgewMfycemghf6sU9EyuFDcNXqvRmSxc",
  "SOL/USDC": "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT",
  "SOL/USDT": "HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1",
  "KIN/USDC": "Bn6NPyr6UzrFAwC4WmvPvDr2Vm8XSUnFykM2aQroedgn",
  "KIN/USDT": "4nCFQr8sahhhL4XJ7kngGFBmpkmyf3xLzemuMhn6mWTm",
  "RAY/USDT": "teE55QrL4a4QSfydR9dnHF97jgCfptpuigbb53Lo95g",
  "RAY/USDC": "2xiv8A5xrJ7RnGdxXB42uFEkYHJjszEhaJyKKt4WaLep",
  "COPE/USDC": "6fc7v3PmjZG9Lk2XTot6BywGyYLkBQuzuFKd4FpCsPxk",
  "SNY/USDC": "DPfj2jYwPaezkCmUNm5SSYfkrkz8WFqwGLcxDDUsN3gA",
  "BOP/USDC": "7MmPwD1K56DthW14P1PnWZ4zPCbPWemGs3YggcT1KzsM",
  "BOP/RAY": "6Fcw8aEs7oP7YeuMrM2JgAQUotYxa4WHKHWdLLXssA3R",
  "DAL/USDT": "5BdxDDTm5G3zFC3DvGrr1nnN95ifE7RDnkdCM11xYCEV",
  "DAL/USDC": "J5EzuaPHiB2zJ2aTfsm5gTSGsBWQbWXc13RBcmiuw1E7",
  "HAMS/USDC": "5j6hdwx4eW3QBYZtRjKiUj7aDA1dxDpveSHBznwq7kUv",
  "INO/USDC": "HyERWE8TEQmDX157oLEpwaTc59ECzmvjUgZhZ2RNtNdn",
  "MEDIA/USDC": "FfiqqvJcVL7oCCu8WQUMHLUC2dnHQPAPjTdSzsERFWjb",
  "LIQ/USDC": "D7p7PebNjpkH6VNHJhmiDFNmpz9XE7UaTv9RouxJMrwb",
  "LIQ/SOL": "F7SrwFTQ8uWBs9zhN9fctLKLJdEAz8fu7XmNyi9Sebht",
  "TULIP/USDC": "8GufnKq7YnXKhnB3WNhgy5PzU9uvHbaaRrZWQK6ixPxW",
  "SLIM/SOL": "GekRdc4eD9qnfPTjUMK5NdQDho8D9ByGrtnqhMNCTm36",
  "STEP/USDC": "97qCB4cAVSTthvJu3eNoEx6AY6DLuRDtCoPm5Tdyg77S",
  "MOLA/USDC": "HSpeWWRqBJ4HH2FPyfDhoN1AUq3gYoDenQGZASSqzYW1",
  "ASH/USDC": "56ZFVzqMqtDmyry9bK7vi1szUV2nuQ4kT6CzFAB649wE",
  "SHBL/USDC": "9G2bAA5Uv8JyPZteuP73GJLUGg5CMbhMLCRSBUBLoXyt",
  "SAIL/USDC": "6hwK66FfUdyhncdQVxWFPRqY8y6usEvzekUaqtpKEKLr",
  "SRM/SOL": "jyei9Fpj2GtHLDDGgcuhDacxYLLiSyxU4TY7KxB2xai",
  "RAY/SRM": "Cm4MmknScg7qbKqytb1mM92xgDxv3TNXos4tKbBqTDy7",
  "SLRS/USDC": "2Gx3UfV831BAh8uQv1FKSPKS9yajfeeD8GJ4ZNb2o2YP",
  "APEX/USDC": "GX26tyJyDxiFj5oaKvNB9npAHNgdoV9ZYHs5ijs5yG2U",
  "GÜ/USDC": "2QXXnRnSBi4tviNUAsYv7tYDvYb17BQhK5MxR4sX5J3B",
  "SAMO/USDC": "FR3SPJmgfRSKKQ2ysUZBu7vJLpzTixXnjzb84bY3Diif",
  "SAMO/RAY": "AAfgwhNU5LMjHojes1SFmENNjihQBDKdDDT1jog4NV8w",
  "LIKE/USDC": "3WptgZZu34aiDrLMUiPntTYZGNZ72yT1yxHYxSdbTArX",
  "SBR/USDC": "HXBi8YBwbh4TXF6PjVw81m8Z3Cc4WBofvauj5SBFdgUs",
  "MER/USDT": "6HwcY27nbeb933UkEcxqJejtjWLfNQFWkGCjAVNes6g7",
  "MER/USDC": "G4LcexdCzzJUKZfqyVDQFzpkjhB1JoCNL8Kooxi9nJz5",
  "GSAIL/USDC": "2zkPyHgQkKG6qJED6MTbjfCfUbZeT9VFwLm1Ld9nKxRp",
  "ORCA/USDC": "8N1KkhaCYDpj3awD58d85n973EwkpeYnRp84y1kdZpMX",
  "CATO/USDC": "9fe1MWiKqUdwift3dEpxuRHWftG72rysCRHbxDy6i9xB",
  "TOX/USDC": "5DgXgvgTnXzg12xJCRQnRmqWV4nNaRGabPM7ALcCaZby",
  "SUNNY/USDC": "Aubv1QBFh4bwB2wbP1DaPW21YyQBLfgjg8L4PHTaPzRc",
  "PRT/USDC": "CsNZMtypiGgxm6JrmYVJWnLnJNsERrmT3mQqujLsGZj",
  "PRT/SOL": "H7ZmXKqEx1T8CTM4EMyqR5zyz4e4vUpWTTbCmYmzxmeW",
  "SOLA/USDC": "4RZ27tjRnSwrtRqsJxDEgsERnDKFs7yx6Ra3HsJvkboy",
  "GRAPE/USDC": "72aW3Sgp1hMTXUiCq8aJ39DX2Jr7sZgumAvdLrLuCMLe",
  "POLIS/USDC": "HxFLKUAmAMLz1jtT3hbvCMELwH5H9tpM2QugP8sKyfhW",
  "ATLAS/USDC": "Di66GTLsV64JgCCYGVcY21RZ173BHkjJVgPyezNN7P1K",
  "ALM/USDC": "DNxn3qM61GZddidjrzc95398SCWhm5BUyt8Y8SdKYr8W",
  "OXYPOOL/USDC": "G1uoNqQzdasMUvXV66Eki5dwjWv5N9YU8oHKJrE4mfka",
  "ABR/USDC": "FrR9FBmiBjm2GjLZbfnCcgkbueUJ78NbBx1qcQKPUQe8",
  "DATE/USDC": "3jszawPiXjuqg5MwAAHS8wehWy1k7de5u5pWmmPZf6dM",
  "NAXAR/USDT": "5WSgaKbwpuy18jHg7mCUXY8YhTL2zVZZkeXi844YTLob",
  "NAXAR/USDC": "AAQR6j1ftW2g6ubAkTjrYvkg3H5aPud7i1GXViHLvRVU",
  "MSOL/SOL": "5cLrMai1DsLRYc1Nio9qMTicsWtvzjzZfJPXyAoF4t1Z",
  "MSOL/USDC": "6oGsL2puUgySccKzn9XA9afqF217LfxP5ocq4B3LWsjy",
  "SOLMOON/USDC": "FZAn2H4kzz4bFuez3Hqgg2qz1sHRQ5mPZkowiWMk95sX",
  "WOOF/USDC": "CwK9brJ43MR4BJz2dwnDM7EXCNyHhGqCJDrAdsEts8n5",
  "CHEEMS/USDC": "5WVBCaUPZF4HP3io9Z56N71cPMJt8qh3c4ZwSjRDeuut",  
  "FLOOF/USDC": "BxcuT1p8FK9cFak4Uuf5nmoAZ7nQGu7FerCMESGqxF7b",
  "BMBO/USDC": "8dpaLWWPv6vFong1D8gHFDmYzHQreXuKcui3XCKBACCj",
  "INU/USDC": "G3Bss3a2tif6eHNzWCh14g5k2H4rwBAmE42tbckUWG5T",
  "LEONIDAS/USDC": "DTEmm1nC7n8vb3KmVabT6dEEnSNeDXNu1jWN4u2DfD7Z",
  "HIMA/USDC": "HCE4wQXApNyFBTK7gYa98QCYbshCz7EkH8axNz3ahvKc",
  "WAGMI/USDC": "eju5JDyaf29jYNfq7VrVAocVxGayDEHVHHiM7MYc331",
  "GENE/USDC": "FwZ2GLyNNrFqXrmR8Sdkm9DQ61YnQmxS6oobeH3rrLUM",
  "CWAR/USDC": "CDYafmdHXtfZadhuXYiR7QaqmK9Ffgk2TA8otUWj9SWz",
  "IN/USDC": "49vwM54DX3JPXpey2daePZPmimxA4CrkXLZ6E1fGxx2Z",
  "DFL/USDC": "9UBuWgKN8ZYXcZWN67Spfp3Yp67DKBq1t31WLrVrPjTR",
  "UXP/USDC": "7KQpsp914VYnh62yV6AGfoG9hprfA14SgzEyqr6u9NY1",
  "TRTLS/USDC": "2dKHkfJGKNxmtwdLcsqXFGcb8Xppw5RP6YVWEWjSfAHm",
  "OOGI/USDC": "ANUCohkG9gamUn6ofZEbnzGkjtyMexDhnjCwbLDmQ8Ub",
  "MINECRAFT/USDC": "HYH4sxk2pCZMJV7pSzg1davjfJbSTVzg5onJUMAMo83r",
  "RUN/USDC": "HCvX4un57v1SdYQ2LFywaDYyZySqLHMQ5cojq5kQJM3y",
  "REAL/USDC": "AU8VGwd4NGRbcMz9LT6Fu2LP69LPAbWUJ6gEfEgeYM33",
  "BASIS/USDC": "HCWgghHfDefcGZsPsLAdMP3NigJwBrptZnXemeQchZ69",
  "TTT/USDC": "2sdQQDyBsHwQBRJFsYAGpLZcxzGscMUd5uxr8jowyYHs",
  "QUEST/USDT": "7QwEMFeKS8mPACndc9EzpgoqKbQhpBm1N4JCtzjGEyR7",
  "NINJA/USDC": "J4oPt5Q3FYxrznkXLkbosAWrJ4rZLqJpGqz7vZUL4eMM",
  "SOLX/USDC": "6DhnyzBiw59MgjjVE1dGwfX8PKSFmN5gagcoCAn6U6x8",
  "SOLAR/USDC": "BHfFJM36MirbBtLCcnZokwRvxUPxk7Ez6EAT6k44q6Go",
  "VINU/USDC": "5mVyYunnpv8ZdRrqNYQaecTrN4mFPK2pZjCvhMnUZiTd",
  "VINU/RAY": "7W9pEftZmMvq9wm9tf5fLfMGMAY3bSa362ve1LzGDZq9",
  "APT/USDC": "ATjWoJDChATL7E5WVeSk9EsoJAhZrHjzCZABNx3Miu8B",
  "MBS/USDC": "9sUSmgx78tt692hzwiRdBdfwjxPF6nsYeJfPCrTz6vxm",
  "GST/USDC": "2JiQd14xAjmcNEJicyU1m3TVbzQDktTvY285gkozD46J"
}

const cache = new LRUCache<string, Trade[]>(
  parseInt(process.env.CACHE_LIMIT ?? '500')
)

const marketStores = {} as any

Object.keys(priceScales).forEach((marketName) => {
  const conn = new Tedis({
    host,
    port,
    password,
  })

  const store = new RedisStore(conn, marketName)
  marketStores[marketName] = store

  // preload heavy markets
  if (['SOL/USDC', 'SOL-PERP', 'BTC-PERP'].includes(marketName)) {
    for (let i = 1; i < 60; ++i) {
      const day = dayjs.default().subtract(i, 'days')
      const key = store.keyForDay(+day)
      store
        .loadTrades(key, cache)
        .then(() => console.log('loaded', key))
        .catch(() => console.error('could not cache', key))
    }
  }
})

const app = express()
app.use(cors())

app.get('/tv/config', async (req, res) => {
  const response = {
    supported_resolutions: Object.keys(resolutions),
    supports_group_request: false,
    supports_marks: false,
    supports_search: true,
    supports_timescale_marks: false,
  }
  res.set('Cache-control', 'public, max-age=360')
  res.send(response)
})

app.get('/tv/symbols', async (req, res) => {
  const symbol = req.query.symbol as string
  const response = {
    name: symbol,
    ticker: symbol,
    description: symbol,
    type: 'Spot',
    session: '24x7',
    exchange: 'Mango',
    listed_exchange: 'Mango',
    timezone: 'Etc/UTC',
    has_intraday: true,
    supported_resolutions: Object.keys(resolutions),
    minmov: 1,
    pricescale: priceScales[symbol] || 100,
  }
  res.set('Cache-control', 'public, max-age=360')
  res.send(response)
})

app.get('/tv/history', async (req, res) => {
  // parse
  const marketName = req.query.symbol as string
  const market =
    nativeMarketsV3[marketName] ||
    groupConfig.perpMarkets.find((m) => m.name === marketName)
  const resolution = resolutions[req.query.resolution as string] as number
  let from = parseInt(req.query.from as string) * 1000
  let to = parseInt(req.query.to as string) * 1000

  // validate
  const validSymbol = market != undefined
  const validResolution = resolution != undefined
  const validFrom = true || new Date(from).getFullYear() >= 2021
  if (!(validSymbol && validResolution && validFrom)) {
    const error = { s: 'error', validSymbol, validResolution, validFrom }
    console.error({ marketName, error })
    res.status(404).send(error)
    return
  }

  // respond
  try {
    const store = marketStores[marketName] as RedisStore

    // snap candle boundaries to exact hours
    from = Math.floor(from / resolution) * resolution
    to = Math.ceil(to / resolution) * resolution

    // ensure the candle is at least one period in length
    if (from == to) {
      to += resolution
    }
    const candles = await store.loadCandles(resolution, from, to, cache)
    const response = {
      s: 'ok',
      t: candles.map((c) => c.start / 1000),
      c: candles.map((c) => c.close),
      o: candles.map((c) => c.open),
      h: candles.map((c) => c.high),
      l: candles.map((c) => c.low),
      v: candles.map((c) => c.volume),
    }
    res.set('Cache-control', 'public, max-age=1')
    res.send(response)
    return
  } catch (e) {
    notify(`tv/history ${marketName} ${e.toString()}`)
    const error = { s: 'error' }
    res.status(500).send(error)
  }
})

app.get('/trades/address/:marketPk', async (req, res) => {
  // parse
  const marketPk = req.params.marketPk as string
  const marketName =
    symbolsByPk[marketPk] ||
    groupConfig.perpMarkets.find((m) => m.publicKey.toBase58() === marketPk)
      ?.name

  // validate
  const validPk = marketName != undefined
  if (!validPk) {
    const error = { s: 'error', validPk }
    res.status(404).send(error)
    return
  }

  // respond
  try {
    const store = marketStores[marketName] as RedisStore
    const trades = await store.loadRecentTrades()
    const response = {
      success: true,
      data: trades.map((t) => {
        return {
          market: marketName,
          marketAddress: marketPk,
          price: t.price,
          size: t.size,
          side: t.side == TradeSide.Buy ? 'buy' : 'sell',
          time: t.ts,
          orderId: '',
          feeCost: 0,
        }
      }),
    }
    res.set('Cache-control', 'public, max-age=5')
    res.send(response)
    return
  } catch (e) {
    notify(`trades ${marketName} ${e.toString()}`)
    const error = { s: 'error' }
    res.status(500).send(error)
  }
})

const httpPort = parseInt(process.env.PORT || '5000')
app.listen(httpPort)
