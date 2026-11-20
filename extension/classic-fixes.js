// Easy Apply fixes for LinkedIn's classic job search, taken unchanged from the
// "LinkedIn Skip Redirect" extension (v1.4.4, content.js).
// After you submit or close the Easy Apply dialog, LinkedIn reloads the classic
// search to an empty "No matching jobs found" page. This script blocks that
// reload, closes the dialog with LinkedIn's own dismiss button, and if a reload
// still happens, sends you back to your last search with results.

(() => {
    const KEY_LAST_GOOD_URL = "lcjs:lastGoodUrl";
    const KEY_APPLIED_AT = "lcjs:appliedAt";
    const KEY_RESTORE_COUNT = "lcjs:restoreCount";
    const KEY_DIALOG_AT = "lcjs:dialogAt";
    const KEY_OPEN_APPLY_JOB = "lcjs:openApplyJobId";
    const KEY_OPEN_APPLY_AT = "lcjs:openApplyAt";
    const DIALOG_RELOAD_WINDOW_MS = 15 * 1000;
    const EASY_APPLY_OPEN_TIMEOUT_MS = 2500;
    const OPEN_APPLY_WINDOW_MS = 20 * 1000;
    const APPLY_WINDOW_MS = 5 * 60 * 1000;
    const MAX_RESTORES = 2;
    const CHECK_INTERVAL_MS = 1000;
    // After applying, give the page time to render the "no results" banner
    // before trusting job cards as real results.
    const SETTLE_AFTER_LOAD_MS = 4000;

    const RESULTS_LIST_SELECTOR = [
        ".jobs-search-results-list",
        ".jobs-search-results__list",
        ".scaffold-layout__list"
    ].join(",");

    const JOB_CARD_SELECTOR = [
        "[data-occludable-job-id]",
        ".jobs-search-results__list-item",
        "[data-job-id]",
        ".job-card-container"
    ].join(",");

    const NO_RESULTS_SELECTOR = [
        ".jobs-search-no-results-banner",
        ".jobs-search-two-pane__no-results-banner",
        "[class*='no-results']"
    ].join(",");

    const NO_RESULTS_TEXT = /no matching jobs found/i;
    const RECOMMENDED_TEXT = /jobs you may be interested in/i;
    const APPLY_BUTTON_TEXT = /submit application|^\s*done\s*$|^\s*(easy\s+)?apply\b|yes,?\s*i applied|i applied/i;

    // Params that point at a specific job or page and can produce an empty list.
    const VOLATILE_PARAMS = ["currentJobId", "start", "refresh", "origin", "referralSearchId", "eBP", "trk"];

    const loadedAt = Date.now();

    const storage = {
        get(key) {
            try { return sessionStorage.getItem(key); } catch { return null; }
        },
        set(key, value) {
            try { sessionStorage.setItem(key, value); } catch { }
        },
        remove(key) {
            try { sessionStorage.removeItem(key); } catch { }
        }
    };

    const isSearchPage = () => /^\/jobs\/search(\/|$)/.test(location.pathname);

    const isOnScreen = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };

    function hasNoResults() {
        // LinkedIn keeps hidden or empty no-results placeholders in the DOM even when
        // results are listed, so only a banner that is actually shown counts.
        for (const el of document.querySelectorAll(NO_RESULTS_SELECTOR)) {
            if (isOnScreen(el) && el.textContent.trim()) return true;
        }
        for (const el of document.querySelectorAll("h1, h2, h3, p")) {
            if (isOnScreen(el) && NO_RESULTS_TEXT.test(el.textContent)) return true;
        }
        return false;
    }

    function isRecommendedCard(card) {
        // Cards under "Jobs you may be interested in" are shown on the empty page too.
        for (let el = card; el && el !== document.body; el = el.parentElement) {
            const heading = el.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > header, :scope > div > h2");
            if (heading && RECOMMENDED_TEXT.test(heading.textContent)) return true;
        }
        return false;
    }

    function hasSearchResults() {
        const lists = document.querySelectorAll(RESULTS_LIST_SELECTOR);
        const cards = lists.length
            ? [...lists].flatMap((list) => [...list.querySelectorAll(JOB_CARD_SELECTOR)])
            : [...document.querySelectorAll(JOB_CARD_SELECTOR)];
        return cards.some((card) => !isRecommendedCard(card));
    }

    function recentlyApplied() {
        const appliedAt = Number(storage.get(KEY_APPLIED_AT));
        return appliedAt > 0 && Date.now() - appliedAt < APPLY_WINDOW_MS;
    }

    function cleanSearchUrl(href) {
        const url = new URL(href);
        for (const param of VOLATILE_PARAMS) url.searchParams.delete(param);
        url.searchParams.set("skipRedirect", "true");
        return url.href;
    }

    // Set while the extension itself navigates, so its own navigation isn't cancelled.
    let selfNavigating = false;
    function go(url) {
        selfNavigating = true;
        location.replace(url);
    }

    function restore() {
        const restoreCount = Number(storage.get(KEY_RESTORE_COUNT)) || 0;
        if (restoreCount >= MAX_RESTORES) {
            // Give up so a search that is genuinely empty can't loop.
            storage.remove(KEY_APPLIED_AT);
            storage.remove(KEY_RESTORE_COUNT);
            return;
        }

        const lastGoodUrl = storage.get(KEY_LAST_GOOD_URL);
        const target = lastGoodUrl || cleanSearchUrl(location.href);
        storage.set(KEY_RESTORE_COUNT, String(restoreCount + 1));
        go(target);
    }

    // After a reload done so Easy Apply works again, open it for the job the user clicked.
    function openPendingEasyApply() {
        const jobId = storage.get(KEY_OPEN_APPLY_JOB);
        if (!jobId) return;
        const clear = () => {
            storage.remove(KEY_OPEN_APPLY_JOB);
            storage.remove(KEY_OPEN_APPLY_AT);
        };
        if (Date.now() - Number(storage.get(KEY_OPEN_APPLY_AT)) > OPEN_APPLY_WINDOW_MS) {
            clear();
            return;
        }
        if (new URL(location.href).searchParams.get("currentJobId") !== jobId) return;

        const button = [...document.querySelectorAll("button")].find((el) =>
            isVisible(el) && !el.closest(DIALOG_SELECTOR) && EASY_APPLY_TEXT.test(el.textContent || ""));
        if (!button) return;
        clear();
        button.click();
    }

    function check() {
        if (!isSearchPage()) return;

        openPendingEasyApply();

        const applied = recentlyApplied();

        if (hasNoResults()) {
            if (applied) restore();
            return;
        }

        if (applied && Date.now() - loadedAt < SETTLE_AFTER_LOAD_MS) return;

        if (hasSearchResults()) {
            storage.set(KEY_LAST_GOOD_URL, cleanSearchUrl(location.href));
            storage.remove(KEY_RESTORE_COUNT);
            // This page loaded after the application and shows results, so recovery is done.
            if (applied && Number(storage.get(KEY_APPLIED_AT)) < loadedAt) {
                storage.remove(KEY_APPLIED_AT);
            }
        }
    }

    // Throttle rather than debounce: LinkedIn mutates the DOM constantly,
    // so a debounced check might never run.
    let pending = false;
    const scheduleCheck = () => {
        if (pending) return;
        pending = true;
        setTimeout(() => {
            pending = false;
            check();
        }, CHECK_INTERVAL_MS);
    };

    const markApplied = () => storage.set(KEY_APPLIED_AT, String(Date.now()));
    const markDialogAction = () => storage.set(KEY_DIALOG_AT, String(Date.now()));

    function sameSearch(a, b) {
        const params = (href) => {
            const url = new URL(cleanSearchUrl(href));
            url.searchParams.sort();
            return url.pathname.replace(/\/$/, "") + "?" + url.searchParams;
        };
        return params(a) === params(b);
    }

    // Closing the apply dialog (submit, done, dismiss, discard) makes LinkedIn reload
    // the page to a search that comes back empty. This script runs at document_start,
    // so send that reload to the last good search before the empty page is drawn.
    const dialogAt = Number(storage.get(KEY_DIALOG_AT));
    storage.remove(KEY_DIALOG_AT);
    const lastGoodUrl = storage.get(KEY_LAST_GOOD_URL);
    if (
        dialogAt > 0 && Date.now() - dialogAt < DIALOG_RELOAD_WINDOW_MS &&
        isSearchPage() && lastGoodUrl && !sameSearch(location.href, lastGoodUrl)
    ) {
        go(lastGoodUrl);
        return;
    }

    const DIALOG_SELECTOR = "[role='dialog'], [role='alertdialog'], .artdeco-modal, .jobs-easy-apply-modal";
    const MODAL_SELECTOR = ".artdeco-modal-overlay, .artdeco-modal, .jobs-easy-apply-modal, [role='dialog'][aria-modal='true'], [role='alertdialog']";
    const EASY_APPLY_TEXT = /easy\s+apply/i;

    const isVisible = (el) => el.getClientRects().length > 0;

    // LinkedIn may render dialogs inside an open shadow root (e.g. #interop-outlet).
    function queryAllDeep(selector, root = document) {
        const found = [...root.querySelectorAll(selector)];
        for (const el of root.querySelectorAll("*")) {
            if (el.shadowRoot) found.push(...queryAllDeep(selector, el.shadowRoot));
        }
        return found;
    }

    const hasOpenModal = () => queryAllDeep(MODAL_SELECTOR).some(isVisible);

    // Set once the extension has closed a LinkedIn dialog itself, since LinkedIn
    // may then not open the next Easy Apply dialog.
    let closedDialogManually = false;
    let lastDialogActionWasSubmit = false;
    const SUBMIT_TEXT = /submit/i;

    const DISMISS_SELECTOR = ".artdeco-modal__dismiss, button[aria-label='Dismiss'], button[data-test-modal-close-btn]";
    const DISMISS_SETTLE_MS = 600;
    let dismissing = false;

    function hideDialogs() {
        // Hide rather than remove: removing nodes LinkedIn still manages breaks its
        // rendering, and then the next Easy Apply dialog never opens.
        for (const el of queryAllDeep(MODAL_SELECTOR)) {
            (el.closest(".artdeco-modal-overlay") || el).style.setProperty("display", "none", "important");
        }
        document.body?.classList.remove("artdeco-modal-is-open");
        closedDialogManually = true;
    }

    // Last resort when LinkedIn still won't open Easy Apply: load the same search with
    // the clicked job selected, and open its Easy Apply once the page is ready.
    function reloadAndOpenEasyApply() {
        const jobId = new URL(location.href).searchParams.get("currentJobId");
        const url = new URL(storage.get(KEY_LAST_GOOD_URL) || cleanSearchUrl(location.href));
        if (jobId) {
            url.searchParams.set("currentJobId", jobId);
            storage.set(KEY_OPEN_APPLY_JOB, jobId);
            storage.set(KEY_OPEN_APPLY_AT, String(Date.now()));
        }
        go(url.href);
    }

    function closeDialogs() {
        if (dismissing) return;
        // Prefer LinkedIn's own dismiss button so its state stays consistent and the
        // next Easy Apply still opens; remove the dialog only if that doesn't close it.
        const dismiss = queryAllDeep(DISMISS_SELECTOR).find(isVisible);
        if (!dismiss) {
            hideDialogs();
            return;
        }
        dismissing = true;
        dismiss.click();
        setTimeout(() => {
            dismissing = false;
            if (hasOpenModal()) hideDialogs();
        }, DISMISS_SETTLE_MS);
    }

    // Submitting or closing the apply dialog makes LinkedIn reload the page, which
    // comes back empty. Cancel that reload and close the dialog here instead, so the
    // current results stay on screen without a refresh.
    if (window.navigation) {
        window.navigation.addEventListener("navigate", (event) => {
            if (selfNavigating || !event.cancelable || event.userInitiated) return;
            if (event.navigationType === "traverse") return;
            if (!isSearchPage()) return;
            if (Date.now() - Number(storage.get(KEY_DIALOG_AT)) > DIALOG_RELOAD_WINDOW_MS) return;

            const destination = new URL(event.destination.url);
            if (!/^\/jobs\/search(-results)?(\/|$)/.test(destination.pathname)) return;

            event.preventDefault();
            // LinkedIn may retry with another full reload, so keep blocking those for
            // the rest of the window. An in-page route change is blocked only once, so
            // selecting the next job still works.
            if (event.destination.sameDocument) storage.remove(KEY_DIALOG_AT);
            // After Submit, keep the "application sent" dialog on screen; close only
            // when the user was dismissing a dialog.
            if (!lastDialogActionWasSubmit) closeDialogs();
        });
    }

    // Clicks in the apply flow (Easy Apply dialog, external Apply button,
    // "Did you apply?" prompt) mark that an application just happened.
    document.addEventListener("click", (event) => {
        // composedPath() reaches the real target inside a shadow-root dialog.
        const target = event.composedPath()[0];
        const button = target instanceof Element && target.closest("button, a");
        if (!button) return;
        const inDialog = !!button.closest(DIALOG_SELECTOR);
        if (inDialog) {
            markDialogAction();
            lastDialogActionWasSubmit = SUBMIT_TEXT.test(button.textContent || "") ||
                SUBMIT_TEXT.test(button.getAttribute("aria-label") || "");
        } else {
            // The user is back on the page (another job, another Easy Apply), so the
            // dialog's reload is over; don't cancel the navigation this click starts.
            storage.remove(KEY_DIALOG_AT);
        }

        // If LinkedIn won't open Easy Apply after a dialog was closed here, reload the
        // same search and open Easy Apply for this job, so the user can still apply.
        if (closedDialogManually && !inDialog && isSearchPage() && EASY_APPLY_TEXT.test(button.textContent || "")) {
            setTimeout(() => {
                if (!hasOpenModal()) reloadAndOpenEasyApply();
            }, EASY_APPLY_OPEN_TIMEOUT_MS);
        }

        if (
            inDialog ||
            button.closest(".jobs-apply-button--top-card") ||
            button.matches(".jobs-apply-button, [data-live-test-job-apply-button]") ||
            APPLY_BUTTON_TEXT.test(button.textContent || "")
        ) {
            markApplied();
        }
    }, true);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.querySelector(DIALOG_SELECTOR)) {
            markDialogAction();
            lastDialogActionWasSubmit = false;
        }
    }, true);

    new MutationObserver(scheduleCheck).observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    scheduleCheck();
})();
