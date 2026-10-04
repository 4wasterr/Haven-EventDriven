class SmsConfigurationError extends Error {
    constructor(message, diagnostic) { super(message); this.diagnostic = diagnostic; }
}
class SmsDeliveryError extends Error {
    constructor(message, diagnostic) { super(message); this.diagnostic = diagnostic; }
}
class SmsBillingError extends SmsDeliveryError {
    constructor(diagnostic) {
        super("We couldn't send an SMS code because the SMS service is unavailable. Please try again later or contact support.", diagnostic);
    }
}

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function normalizePhoneNumber(value, defaultCountry = "PH") {
    if (!value || typeof value !== "string") {
        throw new SmsDeliveryError("A valid phone number is required.");
    }
    let cleaned = value.trim().replace(/[\s().-]/g, "");
    if (cleaned.startsWith("+")) {
        if (!E164_PATTERN.test(cleaned)) {
            throw new SmsDeliveryError("Phone number must follow international E.164 format (e.g., +639171234567).");
        }
        return cleaned;
    }

    // Philippines local format: 09XXXXXXXXX (11 digits) or 9XXXXXXXXX (10 digits)
    if (defaultCountry === "PH") {
        if (cleaned.startsWith("09") && cleaned.length === 11) {
            cleaned = "+63" + cleaned.slice(1);
        } else if (cleaned.startsWith("9") && cleaned.length === 10) {
            cleaned = "+63" + cleaned;
        }
    } else if (defaultCountry === "US" && cleaned.length === 10 && /^[2-9]/.test(cleaned)) {
        cleaned = "+1" + cleaned;
    } else if (defaultCountry === "GB" && cleaned.startsWith("07") && cleaned.length === 11) {
        cleaned = "+44" + cleaned.slice(1);
    } else {
        cleaned = "+" + cleaned;
    }

    if (!E164_PATTERN.test(cleaned)) {
        throw new SmsDeliveryError(`Phone number "${value}" cannot be formatted to a valid E.164 number (e.g., +639171234567).`);
    }
    return cleaned;
}

function parseRecipient(to) {
    if (!to) {
        throw new SmsDeliveryError("Recipient is required.");
    }
    if (typeof to === "string") {
        const trimmed = to.trim();
        return { phone_number: normalizePhoneNumber(trimmed) };
    }
    if (typeof to === "object") {
        if (to.phone_number) {
            return { phone_number: normalizePhoneNumber(String(to.phone_number)) };
        }
    }
    throw new SmsDeliveryError("SMS verification requires a phone_number. Email verification uses Resend.");
}

function getSmsConfiguration(env = process.env) {
    const apiKey = env.INFOBIP_API_KEY?.trim() || "";
    const applicationId = env.INFOBIP_2FA_APPLICATION_ID?.trim() || "";
    const messageId = env.INFOBIP_2FA_MESSAGE_ID?.trim() || "";
    const apiKeyPattern = /^[a-f0-9]{32}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
    if (apiKeyPattern.test(applicationId) || apiKeyPattern.test(messageId)) {
        throw new SmsConfigurationError(
            "SMS verification is not configured yet. Please contact support.",
            "An Infobip API key was entered as a 2FA resource ID. Put the Onboarding 2FA key in INFOBIP_API_KEY. Create a 2FA application and message template, then put their returned applicationId and messageId in INFOBIP_2FA_APPLICATION_ID and INFOBIP_2FA_MESSAGE_ID. Restart the backend."
        );
    }
    let url;
    try {
        const raw = env.INFOBIP_BASE_URL?.trim() || "";
        url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {}
    if (!apiKey || /\s/.test(apiKey) || !validProviderId(applicationId) || !validProviderId(messageId) ||
        !url || url.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)?api\.infobip\.com$/i.test(url.hostname) ||
        url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
        throw new SmsConfigurationError(
            "SMS verification is not configured yet. Please contact support.",
            "Set INFOBIP_API_KEY, INFOBIP_BASE_URL, INFOBIP_2FA_APPLICATION_ID and INFOBIP_2FA_MESSAGE_ID in backend/.env, then restart the backend. Use the HTTPS API base URL from your Infobip account."
        );
    }
    return { provider: "infobip", apiKey, baseUrl: url.origin, applicationId, messageId };
}

function validProviderId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function providerPhone(value) {
    if (typeof value !== "string") return null;
    const normalized = value.startsWith("+") ? value : `+${value}`;
    return E164_PATTERN.test(normalized) ? normalized : null;
}
function mapInfobipError(status) {
    const unavailable = "The SMS service is unavailable. Please try again later or contact support.";
    if (status === 401 || status === 403) {
        return new SmsConfigurationError(unavailable, "Infobip denied 2FA access. Check INFOBIP_API_KEY and its 2fa:manage scope, trial eligibility, verified recipients and the account's SMS channel in Infobip Portal.");
    }
    if (status === 402) {
        return new SmsBillingError("Infobip requires billing coverage. Check the free SMS allowance, 60-day trial period and account balance in Infobip Portal.");
    }
    if (status === 400) {
        return new SmsDeliveryError("The SMS service couldn't send a code to this number. Please contact support.",
            "Infobip rejected the 2FA request. Check the application and numeric six-digit template IDs, verified trial recipient and trial sender shown in Infobip Portal.");
    }
    if (status === 429) {
        return new SmsDeliveryError("Too many SMS requests. Please wait and try again later.", "Infobip 2FA rate limit reached.");
    }
    if (status === 404) {
        return new SmsConfigurationError(unavailable, "Infobip 2FA application or template was not found. Check the API base URL, application ID and message ID.");
    }
    return new SmsDeliveryError(unavailable, `Infobip 2FA request failed (HTTP ${status}). Check the SMS logs in Infobip Portal.`);
}

async function infobipRequest(config, route, body, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    let response;
    try {
        response = await fetchImpl(`${config.baseUrl}/2fa/2${route}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                Authorization: `App ${config.apiKey}`,
                Accept: "application/json",
                ...(body === undefined ? {} : { "Content-Type": "application/json" })
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: "error",
            signal: AbortSignal.timeout(10000)
        });
    } catch {
        throw new SmsDeliveryError("Could not confirm the SMS request. Please try again later.", "Could not connect to Infobip 2FA. Check the network connection. No automatic resend was attempted.");
    }
    const data = await response.json().catch(() => null);
    return { response, data };
}

async function checkSmsAccess(options = {}) {
    const config = getSmsConfiguration(options.env);
    // Reading application/template settings never dispatches a message.
    const path = `/applications/${encodeURIComponent(config.applicationId)}`;
    const application = await infobipRequest(config, path, undefined, options);
    if (!application.response.ok) {
        const error = mapInfobipError(application.response.status);
        return { provider: config.provider, accessible: false, status: application.response.status, message: error.diagnostic || error.message };
    }
    const { response, data } = await infobipRequest(config, `${path}/messages/${encodeURIComponent(config.messageId)}`, undefined, options);
    const settings = application.data?.configuration;
    const accessible = response.ok && application.data?.applicationId === config.applicationId && application.data.enabled === true &&
        settings?.pinAttempts === 3 && settings.allowMultiplePinVerifications === false && settings.pinTimeToLive === "5m" &&
        data?.applicationId === config.applicationId && data.messageId === config.messageId && data.pinLength === 6 && data.pinType === "NUMERIC";
    const error = !response.ok && mapInfobipError(response.status);
    return {
        provider: config.provider, accessible, status: response.status,
        message: accessible ? "Infobip 2FA application and six-digit numeric template are accessible. This check does not confirm remaining trial units, country coverage or handset delivery." :
            response.ok ? "Check Infobip 2FA settings: enabled application, pinAttempts=3, allowMultiplePinVerifications=false, pinTimeToLive=5m, pinLength=6 and pinType=NUMERIC. The template must belong to the configured application." : error.diagnostic || error.message
    };
}

async function createVerification(params, options = {}) {
    const recipient = parseRecipient(params?.to || params);
    const config = getSmsConfiguration(options.env);
    const access = await checkSmsAccess(options);
    if (!access.accessible) throw new SmsConfigurationError("SMS verification is unavailable. Please contact support.", access.message);
    const { response, data } = await infobipRequest(config, "/pin?ncNeeded=false", {
        applicationId: config.applicationId, messageId: config.messageId, to: recipient.phone_number.slice(1)
    }, options);
    if (!response.ok) throw mapInfobipError(response.status);
    if (!validProviderId(data?.pinId) || data.smsStatus !== "MESSAGE_SENT" || providerPhone(data.to) !== recipient.phone_number) {
        throw new SmsDeliveryError("Could not confirm that an SMS code was sent. Please try again later.", "Infobip did not accept the SMS PIN request for the expected recipient. Check the verified trial number, allowed sender and free SMS allowance.");
    }
    return { id: `infobip:${data.pinId}`, status: "pending", to: recipient, expiresAt: null, recipient };
}

async function checkVerification({ to, code, id }, options = {}) {
    const recipient = parseRecipient(to);
    const cleanCode = String(code || "").trim();
    if (!/^\d{6}$/.test(cleanCode)) {
        throw new SmsDeliveryError("A six-digit verification code is required.");
    }
    if (id === undefined) throw new SmsDeliveryError("The verification ID is required. Request a new SMS code.");
    // Challenges from a previous provider cannot be verified through Infobip.
    const pinId = typeof id === "string" && id.startsWith("infobip:") ? id.slice(8) : "";
    if (!validProviderId(pinId)) {
        return { success: false, reason: "not_found", verification: null };
    }
    const config = getSmsConfiguration(options.env);
    const { response, data } = await infobipRequest(config, `/pin/${encodeURIComponent(pinId)}/verify`, { pin: cleanCode }, options);
    if (!response.ok) {
        if (response.status === 404) return { success: false, reason: "not_found", verification: null };
        throw mapInfobipError(response.status);
    }
    if (data?.pinId !== pinId || providerPhone(data.msisdn) !== recipient.phone_number || typeof data.verified !== "boolean" ||
        (data.verified && data.pinError)) {
        throw new SmsDeliveryError("Could not confirm the verification code. Please try again later.", "Infobip returned an unexpected PIN verification response; no mobile verification was granted.");
    }
    const success = data.verified;
    return {
        success,
        reason: success ? null : data.pinError === "PIN_EXPIRED" ? "expired" : data.attemptsRemaining === 0 ? "attempts_exhausted" : "incorrect_code",
        attemptsRemaining: Number.isInteger(data.attemptsRemaining) ? data.attemptsRemaining : null,
        verification: { id, status: success ? "verified" : "pending" }
    };
}

module.exports = {
    SmsConfigurationError,
    SmsDeliveryError,
    SmsBillingError,
    getSmsConfiguration,
    checkSmsAccess,
    normalizePhoneNumber,
    parseRecipient,
    createVerification,
    checkVerification
};
