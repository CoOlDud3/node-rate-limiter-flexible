/* eslint-disable new-cap */
/* eslint-disable no-unused-expressions */
const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const sinon = require('sinon');
const RateLimiterRedis = require('../lib/RateLimiterRedis');
const redisMock = require('redis-mock');
const { redisEvalMock, getRedisClientClosed } = require('./helper');

describe('RateLimiterRedis with fixed window', function RateLimiterRedisTest() {
  this.timeout(5000);
  const redisMockClient = redisMock.createClient();

  redisMockClient.eval = redisEvalMock(redisMockClient);

  const redisClientClosed = getRedisClientClosed(redisMockClient);

  beforeEach((done) => {
    redisMockClient.flushall(done);
  });

  it('consume 1 point', (done) => {
    const testKey = 'consume1';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 5,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        redisMockClient.get(rateLimiter.getKey(testKey), (err, consumedPoints) => {
          if (!err) {
            expect(consumedPoints).to.equal('1');
            done();
          }
        });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('rejected when consume more than maximum points', (done) => {
    const testKey = 'consume2';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 5,
    });
    rateLimiter
      .consume(testKey, 2)
      .then(() => {})
      .catch((rejRes) => {
        expect(rejRes.msBeforeNext >= 0).to.equal(true);
        done();
      });
  });

  it('execute evenly over duration', (done) => {
    const testKey = 'consumeEvenly';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 5,
      execEvenly: true,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        const timeFirstConsume = Date.now();
        rateLimiter
          .consume(testKey)
          .then(() => {
            /* Second consume should be delayed more than 2 seconds
               Explanation:
               1) consume at 0ms, remaining duration = 5000ms
               2) delayed consume for (4999 / (0 + 2)) ~= 2500ms, where 2 is a fixed value
                , because it mustn't delay in the beginning and in the end of duration
               3) consume after 2500ms by timeout
            */
            const diff = Date.now() - timeFirstConsume;
            expect(diff > 2400 && diff < 2600).to.equal(true);
            done();
          })
          .catch((err) => {
            done(err);
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('execute evenly over duration with minimum delay 20 ms', (done) => {
    const testKey = 'consumeEvenlyMinDelay';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 100,
      duration: 1,
      execEvenly: true,
      execEvenlyMinDelayMs: 20,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        const timeFirstConsume = Date.now();
        rateLimiter
          .consume(testKey)
          .then(() => {
            expect(Date.now() - timeFirstConsume >= 20).to.equal(true);
            done();
          })
          .catch((err) => {
            done(err);
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('makes penalty', (done) => {
    const testKey = 'penalty1';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 3,
      duration: 5,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        rateLimiter
          .penalty(testKey)
          .then(() => {
            redisMockClient.get(rateLimiter.getKey(testKey), (err, consumedPoints) => {
              if (!err) {
                expect(consumedPoints).to.equal('2');
                done();
              }
            });
          })
          .catch((err) => {
            done(err);
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('reward points', (done) => {
    const testKey = 'reward';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 5,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        rateLimiter
          .reward(testKey)
          .then(() => {
            redisMockClient.get(rateLimiter.getKey(testKey), (err, consumedPoints) => {
              if (!err) {
                expect(consumedPoints).to.equal('0');
                done();
              }
            });
          })
          .catch((err) => {
            done(err);
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('block key in memory when inMemory block options set up', (done) => {
    const testKey = 'blockmem';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 5,
      inMemoryBlockOnConsumed: 2,
      inMemoryBlockDuration: 10,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        rateLimiter
          .consume(testKey)
          .then(() => {})
          .catch((rejRes) => {
            // msBeforeNext more than 5000, so key was blocked
            expect(rejRes.msBeforeNext > 5000 && rejRes.remainingPoints === 0).to.equal(true);
            done();
          });
      })
      .catch((rejRes) => {
        done(rejRes);
      });
  });

  it('block key in memory for msBeforeNext milliseconds', (done) => {
    const testKey = 'blockmempoints';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 5,
      inMemoryBlockOnConsumed: 1,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        expect(rateLimiter._inMemoryBlockedKeys.msBeforeExpire(rateLimiter.getKey(testKey)) > 0).to.equal(true);
        done();
      })
      .catch((rejRes) => {
        done(rejRes);
      });
  });

  it('reject after block key in memory for msBeforeNext, if consumed more than points', (done) => {
    const testKey = 'blockmempointsreject';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 5,
      inMemoryBlockOnConsumed: 1,
    });
    rateLimiter
      .consume(testKey, 2)
      .then(() => {
        done(new Error('must not'));
      })
      .catch(() => {
        expect(rateLimiter._inMemoryBlockedKeys.msBeforeExpire(rateLimiter.getKey(testKey)) > 0).to.equal(true);
        done();
      });
  });

  it('expire inMemory blocked key', (done) => {
    const testKey = 'blockmem2';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 1,
      inMemoryBlockOnConsumed: 2,
      inmemoryBlockDuration: 2, // @deprecated Kept to test backward compatability
    });
    // It blocks on the first consume as consumed points more than available
    rateLimiter
      .consume(testKey, 2)
      .then(() => {})
      .catch(() => {
        setTimeout(() => {
          rateLimiter
            .consume(testKey)
            .then((res) => {
              // Block expired
              expect(res.msBeforeNext <= 1000 && res.remainingPoints === 0).to.equal(true);
              done();
            })
            .catch((rejRes) => {
              done(rejRes);
            });
        }, 2001);
      });
  });

  it('throws error when inMemoryBlockOnConsumed is not set, but inMemoryBlockDuration is set', (done) => {
    try {
      const rateLimiter = new RateLimiterRedis({
        storeClient: redisMockClient,
        inMemoryBlockDuration: 2,
      });
      rateLimiter.reward('test');
    } catch (err) {
      expect(err instanceof Error).to.equal(true);
      done();
    }
  });

  it('throws error when inMemoryBlockOnConsumed less than points', (done) => {
    try {
      const rateLimiter = new RateLimiterRedis({
        storeClient: redisMockClient,
        points: 2,
        inmemoryBlockOnConsumed: 1, // @deprecated Kept to test backward compatability
      });
      rateLimiter.reward('test');
    } catch (err) {
      expect(err instanceof Error).to.equal(true);
      done();
    }
  });

  it('throws error on RedisClient error', (done) => {
    const testKey = 'rediserror';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisClientClosed,
    });

    rateLimiter
      .consume(testKey)
      .then(() => {})
      .catch((rejRes) => {
        expect(rejRes instanceof Error).to.equal(true);
        done();
      });
  });

  it('consume using insuranceLimiter when RedisClient error', (done) => {
    const testKey = 'rediserror2';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisClientClosed,
      points: 1,
      duration: 1,
      insuranceLimiter: new RateLimiterRedis({
        points: 2,
        duration: 2,
        storeClient: redisMockClient,
      }),
    });

    // Consume from insurance limiter with different options
    rateLimiter
      .consume(testKey)
      .then((res) => {
        expect(res.remainingPoints === 1 && res.msBeforeNext > 1000).to.equal(true);
        done();
      })
      .catch((rejRes) => {
        done(rejRes);
      });
  });

  it('penalty using insuranceLimiter when RedisClient error', (done) => {
    const testKey = 'rediserror3';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisClientClosed,
      points: 1,
      duration: 1,
      insuranceLimiter: new RateLimiterRedis({
        points: 2,
        duration: 2,
        storeClient: redisMockClient,
      }),
    });

    rateLimiter
      .penalty(testKey)
      .then(() => {
        redisMockClient.get(rateLimiter.getKey(testKey), (err, consumedPoints) => {
          if (!err) {
            expect(consumedPoints).to.equal('1');
            done();
          }
        });
      })
      .catch((rejRes) => {
        done(rejRes);
      });
  });

  it('reward using insuranceLimiter when RedisClient error', (done) => {
    const testKey = 'rediserror4';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisClientClosed,
      points: 1,
      duration: 1,
      insuranceLimiter: new RateLimiterRedis({
        points: 2,
        duration: 2,
        storeClient: redisMockClient,
      }),
    });

    rateLimiter
      .consume(testKey, 2)
      .then(() => {
        rateLimiter
          .reward(testKey)
          .then(() => {
            redisMockClient.get(rateLimiter.getKey(testKey), (err, consumedPoints) => {
              if (!err) {
                expect(consumedPoints).to.equal('1');
                done();
              }
            });
          })
          .catch((rejRes) => {
            done(rejRes);
          });
      })
      .catch((rejRes) => {
        done(rejRes);
      });
  });

  it('block using insuranceLimiter when RedisClient error', (done) => {
    const testKey = 'rediserrorblock';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisClientClosed,
      points: 1,
      duration: 1,
      insuranceLimiter: new RateLimiterRedis({
        points: 1,
        duration: 1,
        storeClient: redisMockClient,
      }),
    });

    rateLimiter
      .block(testKey, 3)
      .then((res) => {
        expect(res.msBeforeNext > 2000 && res.msBeforeNext <= 3000).to.equal(true);
        done();
      })
      .catch(() => {
        done(Error('must not reject'));
      });
  });

  it('use keyPrefix from options', () => {
    const testKey = 'key';
    const keyPrefix = 'test';
    const rateLimiter = new RateLimiterRedis({ keyPrefix, storeClient: redisClientClosed });

    expect(rateLimiter.getKey(testKey)).to.equal('test:key');
  });

  it('blocks key for block duration when consumed more than points', (done) => {
    const testKey = 'block';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 1,
      blockDuration: 2,
    });
    rateLimiter
      .consume(testKey, 2)
      .then(() => {
        done(Error('must not resolve'));
      })
      .catch((rej) => {
        expect(rej.msBeforeNext > 1000).to.equal(true);
        done();
      });
  });

  it('reject with error, if internal block by blockDuration failed', (done) => {
    const testKey = 'blockdurationfailed';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 1,
      blockDuration: 2,
    });
    sinon.stub(rateLimiter, '_block').callsFake(() => Promise.reject(new Error()));
    rateLimiter
      .consume(testKey, 2)
      .then(() => {
        done(Error('must not resolve'));
      })
      .catch((rej) => {
        expect(rej instanceof Error).to.equal(true);
        done();
      });
  });

  it('block expires in blockDuration seconds', (done) => {
    const testKey = 'blockexpires';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 1,
      blockDuration: 2,
    });
    rateLimiter
      .consume(testKey, 2)
      .then(() => {
        done(Error('must not resolve'));
      })
      .catch(() => {
        setTimeout(() => {
          rateLimiter
            .consume(testKey)
            .then((res) => {
              expect(res.consumedPoints).to.equal(1);
              done();
            })
            .catch(() => {
              done(Error('must resolve'));
            });
        }, 2000);
      });
  });

  it('block custom key', (done) => {
    const testKey = 'blockcustom';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 1,
    });
    rateLimiter.block(testKey, 2).then(() => {
      rateLimiter
        .consume(testKey)
        .then(() => {
          done(Error('must not resolve'));
        })
        .catch((rej) => {
          expect(rej.msBeforeNext > 1000).to.equal(true);
          done();
        });
    });
  });

  it('get points', (done) => {
    const testKey = 'get';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 1,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        rateLimiter
          .get(testKey)
          .then((res) => {
            expect(res.consumedPoints).to.equal(1);
            done();
          })
          .catch(() => {
            done(Error('get must not reject'));
          });
      })
      .catch(() => {
        done(Error('consume must not reject'));
      });
  });

  describe('disconnected redis client', () => {
    it('attempt to invoke redis if rejectIfRedisNotReady is not set', (done) => {
      const testKey = 'get';

      const rateLimiter = new RateLimiterRedis({
        storeClient: redisClientClosed,
        points: 2,
        duration: 1,
      });
      rateLimiter
        .consume(testKey)
        .catch((error) => {
          expect(error.message).to.equal('closed');
          done();
        });
    });

    it('get throws error with mock redis', (done) => {
      const testKey = 'get';

      const rateLimiter = new RateLimiterRedis({
        storeClient: redisClientClosed,
        points: 2,
        duration: 1,
        rejectIfRedisNotReady: true,
      });
      rateLimiter
        .consume(testKey)
        .catch((error) => {
          expect(error.message).to.equal('Redis connection is not ready');
          done();
        });
    });

    it('get throws error with disconnected ioredis', (done) => {
      const testKey = 'get';

      const disconnectedIoRedis = {
        status: 'closed',
      };

      const rateLimiter = new RateLimiterRedis({
        storeClient: disconnectedIoRedis,
        points: 2,
        duration: 1,
        rejectIfRedisNotReady: true,
      });
      rateLimiter
        .consume(testKey)
        .catch((error) => {
          expect(error.message).to.equal('Redis connection is not ready');
          done();
        });
    });

    it('get throws error with disconnected node-redis', (done) => {
      const testKey = 'get';

      const disconnectedIoRedis = {
        isReady: () => false,
      };

      const rateLimiter = new RateLimiterRedis({
        storeClient: disconnectedIoRedis,
        points: 2,
        duration: 1,
        rejectIfRedisNotReady: true,
      });
      rateLimiter
        .consume(testKey)
        .catch((error) => {
          expect(error.message).to.equal('Redis connection is not ready');
          done();
        });
    });
  });

  it('get returns NULL if key is not set', (done) => {
    const testKey = 'getnull';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 1,
    });
    rateLimiter
      .get(testKey)
      .then((res) => {
        expect(res).to.equal(null);
        done();
      })
      .catch(() => {
        done(Error('get must not reject'));
      });
  });

  it('get supports ioredis format', (done) => {
    const testKey = 'getioredis';
    class multiStubIoRedisClient {
      multi() {
        const multi = redisMockClient.multi();
        multi.exec = (cb) => {
          cb(null, [[null, '2'], [null, 4993]]);
        };

        return multi;
      }
    }

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 3,
      duration: 5,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        rateLimiter.client = new multiStubIoRedisClient();
        rateLimiter
          .get(testKey)
          .then((res) => {
            expect(res.remainingPoints).to.equal(1);
            done();
          })
          .catch(() => {
            done(Error('get must not reject'));
          });
      })
      .catch(() => {
        done(Error('consume must not reject'));
      });
  });

  it('delete key and return true', (done) => {
    const testKey = 'deletetrue';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 1,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        rateLimiter.delete(testKey)
          .then((resDel) => {
            expect(resDel).to.equal(true);
            done();
          });
      });
  });

  it('delete returns false, if there is no key', (done) => {
    const testKey = 'deletefalse';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 1,
    });
    rateLimiter.delete(testKey)
      .then((resDel) => {
        expect(resDel).to.equal(false);
        done();
      });
  });

  it('delete rejects on error', (done) => {
    const testKey = 'deleteerr';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisClientClosed,
      points: 2,
      duration: 1,
    });
    rateLimiter.delete(testKey)
      .catch(() => done());
  });

  it('consume applies options.customDuration to set expire', (done) => {
    const testKey = 'consume.customDuration';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 5,
    });
    rateLimiter
      .consume(testKey, 1, { customDuration: 1 })
      .then((res) => {
        expect(res.msBeforeNext <= 1000).to.be.true;
        done();
      })
      .catch((err) => {
        done(err);
      });
  });

  it('insurance limiter on error consume applies options.customDuration to set expire', (done) => {
    const testKey = 'consume.customDuration';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 2,
      duration: 5,
    });
    rateLimiter
      .consume(testKey, 1, { customDuration: 1 })
      .then((res) => {
        expect(res.msBeforeNext <= 1000).to.be.true;
        done();
      })
      .catch((err) => {
        done(err);
      });
  });

  it('insurance limiter on error consume applies options.customDuration to set expire', (done) => {
    const testKey = 'consume.customDuration.onerror';

    const rateLimiter = new RateLimiterRedis({
      storeClient: redisClientClosed,
      points: 1,
      duration: 2,
      insuranceLimiter: new RateLimiterRedis({
        points: 2,
        duration: 3,
        storeClient: redisMockClient,
      }),
    });

    // Consume from insurance limiter with different options
    rateLimiter
      .consume(testKey, 1, { customDuration: 1 })
      .then((res) => {
        expect(res.remainingPoints === 1 && res.msBeforeNext <= 1000).to.equal(true);
        done();
      })
      .catch((rejRes) => {
        done(rejRes);
      });
  });

  it('block key in memory works with blockDuration on store', (done) => {
    const testKey = 'blockmem+blockduration';
    const rateLimiter = new RateLimiterRedis({
      storeClient: redisMockClient,
      points: 1,
      duration: 5,
      blockDuration: 10,
      inMemoryBlockOnConsumed: 2,
      inMemoryBlockDuration: 10,
    });
    rateLimiter
      .consume(testKey)
      .then(() => {
        rateLimiter
          .consume(testKey)
          .then(() => {})
          .catch((rejRes) => {
            rateLimiter.get(testKey)
              .then((getRes) => {
                expect(getRes.msBeforeNext > 5000 && rejRes.remainingPoints === 0).to.equal(true);
                // msBeforeNext more than 5000, so key was blocked in memory
                expect(rejRes.msBeforeNext > 5000 && rejRes.remainingPoints === 0).to.equal(true);
                done();
              });
          });
      })
      .catch((rejRes) => {
        done(rejRes);
      });
  });

  it('does not expire key if duration set to 0', (done) => {
    const testKey = 'neverexpire';
    const rateLimiter = new RateLimiterRedis({ storeClient: redisMockClient, points: 2, duration: 0 });
    rateLimiter.consume(testKey, 1)
      .then(() => {
        rateLimiter.consume(testKey, 1)
          .then(() => {
            rateLimiter.get(testKey)
              .then((res) => {
                expect(res.consumedPoints).to.equal(2);
                expect(res.msBeforeNext).to.equal(-1);
                done();
              });
          })
          .catch((err) => {
            done(err);
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('block key forever, if secDuration is 0', (done) => {
    const testKey = 'neverexpire';
    const rateLimiter = new RateLimiterRedis({ storeClient: redisMockClient, points: 1, duration: 1 });
    rateLimiter.block(testKey, 0)
      .then(() => {
        setTimeout(() => {
          rateLimiter.get(testKey)
            .then((res) => {
              expect(res.consumedPoints).to.equal(2);
              expect(res.msBeforeNext).to.equal(-1);
              done();
            });
        }, 2000);
      })
      .catch((err) => {
        done(err);
      });
  });

  it('set points by key', (done) => {
    const testKey = 'set';
    const rateLimiter = new RateLimiterRedis({ storeClient: redisMockClient, points: 1, duration: 1 });
    rateLimiter.set(testKey, 12)
      .then(() => {
        rateLimiter.get(testKey)
          .then((res) => {
            expect(res.consumedPoints).to.equal(12);
            done();
          });
      })
      .catch((err) => {
        done(err);
      });
  });

  it('set points by key forever', (done) => {
    const testKey = 'setforever';
    const rateLimiter = new RateLimiterRedis({ storeClient: redisMockClient, points: 1, duration: 1 });
    rateLimiter.set(testKey, 12, 0)
      .then(() => {
        setTimeout(() => {
          rateLimiter.get(testKey)
            .then((res) => {
              expect(res.consumedPoints).to.equal(12);
              expect(res.msBeforeNext).to.equal(-1);
              done();
            });
        }, 1100);
      })
      .catch((err) => {
        done(err);
      });
  });
});
