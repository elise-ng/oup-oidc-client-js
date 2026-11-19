import { SilentRenewService } from '../../src/SilentRenewService';
import { ErrorResponse } from '../../src/ErrorResponse';

import chai from 'chai';
chai.should();

const MaxTimerRuns = 50;

describe("SilentRenewService", function () {
    let realSetTimeout;
    let realClearTimeout;
    let timers;
    let delays;
    let userManager;
    let idleCallbacks;
    let rejection;
    let pendingReject;
    let calls;
    let errorsRaised;

    function flush() {
        return new Promise(r => setImmediate(r));
    }

    function runAllTimers(runs = 0) {
        return flush().then(() => {
            if (timers.length === 0 || runs >= MaxTimerRuns) {
                return;
            }
            timers.shift().fn();
            return runAllTimers(runs + 1);
        });
    }

    function createSubject(retryInterval = 5000) {
        const subject = new SilentRenewService(userManager, (onIdle, onActive) => {
            idleCallbacks = { onIdle, onActive };
            return { unbind() {} };
        }, retryInterval);
        subject.start();
        return subject;
    }

    function holdNextRenew() {
        userManager.signinSilent = () => {
            calls++;
            userManager.signinSilent = defaultSigninSilent;
            return new Promise((resolve, reject) => { pendingReject = reject; });
        };
    }

    function defaultSigninSilent() {
        calls++;
        return Promise.reject(rejection);
    }

    beforeEach(function () {
        realSetTimeout = global.setTimeout;
        realClearTimeout = global.clearTimeout;
        timers = [];
        let nextId = 1;
        delays = [];
        global.setTimeout = (fn, delay) => {
            const id = nextId++;
            delays.push(delay);
            timers.push({ id, fn });
            return id;
        };
        global.clearTimeout = (id) => {
            timers = timers.filter(t => t.id !== id);
        };

        calls = 0;
        errorsRaised = 0;
        rejection = new Error("Network Error");
        userManager = {
            events: {
                addAccessTokenExpiring(cb) { this.expiring = cb; },
                addAccessTokenExpired(cb) { this.expired = cb; },
                removeAccessTokenExpiring() { delete this.expiring; },
                removeAccessTokenExpired() { delete this.expired; },
                _raiseSilentRenewError() { errorsRaised++; }
            },
            signinSilent: defaultSigninSilent,
            getUser() { return Promise.resolve(null); }
        };
    });

    afterEach(function () {
        global.setTimeout = realSetTimeout;
        global.clearTimeout = realClearTimeout;
    });

    it("should not retry invalid_grant", function () {
        rejection = new Error("invalid_grant");
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => calls.should.equal(1));
    });

    it("should not retry login_required", function () {
        rejection = new ErrorResponse({ error: "login_required" });
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => calls.should.equal(1));
    });

    it("should stop after 3 retries", function () {
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => calls.should.equal(4));
    });

    it("should double the retry delay each time", function () {
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => delays.should.deep.equal([5000, 10000, 20000]));
    });

    it("should restart the retry delay on a new expiring event", function () {
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => {
            delays = [];
            userManager.events.expiring();
            return runAllTimers();
        }).then(() => delays.should.deep.equal([5000, 10000, 20000]));
    });

    it("should not retry a string rejection forever", function () {
        rejection = "No access token returned from token endpoint";
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => calls.should.equal(4));
    });

    it("should not retry after expiry during a renew", function () {
        createSubject();
        holdNextRenew();
        userManager.events.expiring();
        userManager.events.expired();
        pendingReject(new Error("Network Error"));
        return runAllTimers().then(() => calls.should.equal(1));
    });

    it("should not retry after stop during a renew", function () {
        const subject = createSubject();
        holdNextRenew();
        userManager.events.expiring();
        subject.stop();
        pendingReject(new Error("Network Error"));
        return runAllTimers().then(() => calls.should.equal(1));
    });

    it("should not retry when interval is 0", function () {
        createSubject(0);
        userManager.events.expiring();
        return runAllTimers().then(() => calls.should.equal(1));
    });

    it("should reset the retry count on a new expiring event", function () {
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => {
            userManager.events.expiring();
            return runAllTimers();
        }).then(() => calls.should.equal(8));
    });

    it("should reset the retry count on return from idle", function () {
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => {
            idleCallbacks.onIdle();
            userManager.events.expiring();
            idleCallbacks.onActive();
            return runAllTimers();
        }).then(() => calls.should.equal(8));
    });

    it("should raise silentRenewError on each failure", function () {
        createSubject();
        userManager.events.expiring();
        return runAllTimers().then(() => errorsRaised.should.equal(4));
    });
});
