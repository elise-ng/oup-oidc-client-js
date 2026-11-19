import random from '../../src/random'

describe('random', function() {
  it("should return 32 lowercase hex characters", function () {
    random().should.match(/^[0-9a-f]{32}$/);
  });
  it("should return a different value each call", function () {
    random().should.not.equal(random());
  });
})
