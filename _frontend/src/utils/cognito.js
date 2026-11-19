const COGNITO_USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";
const COGNITO_STORAGE_PREFIX = "CognitoIdentityServiceProvider.";

let userPool = null;
let cognitoSdk = null;

async function getCognitoSdk() {
  if (!cognitoSdk) {
    cognitoSdk = await import("amazon-cognito-identity-js");
  }
  return cognitoSdk;
}

function ensurePoolConfig() {
  if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
    throw new Error(
      "Missing Cognito config. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID."
    );
  }
}

function buildCookieStorage() {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const secureFlag = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAgeSeconds = 8 * 60 * 60;
  return {
    setItem(key, value) {
      document.cookie = `${key}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secureFlag}`;
      return value;
    },
    getItem(key) {
      const prefix = `${key}=`;
      const cookie = document.cookie.split('; ').find(c => c.startsWith(prefix));
      return cookie ? cookie.slice(prefix.length) : null;
    },
    removeItem(key) {
      document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax${secureFlag}`;
    },
    clear() {
      document.cookie.split('; ').forEach(cookie => {
        const key = cookie.split('=')[0];
        if (key.startsWith(COGNITO_STORAGE_PREFIX)) {
          document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax${secureFlag}`;
        }
      });
    },
  };
}

function clearLegacyCognitoWebStorage() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage) {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith(COGNITO_STORAGE_PREFIX))
        .forEach((key) => window.localStorage.removeItem(key));
    }
    if (window.sessionStorage) {
      Object.keys(window.sessionStorage)
        .filter((key) => key.startsWith(COGNITO_STORAGE_PREFIX))
        .forEach((key) => window.sessionStorage.removeItem(key));
    }
  } catch {
    // ignore
  }
}

async function getUserPool() {
  if (!userPool) {
    ensurePoolConfig();
    clearLegacyCognitoWebStorage();
    const { CognitoUserPool } = await getCognitoSdk();
    const cookieStorage = buildCookieStorage();
    userPool = new CognitoUserPool({
      UserPoolId: COGNITO_USER_POOL_ID,
      ClientId: COGNITO_CLIENT_ID,
      ...(cookieStorage ? { Storage: cookieStorage } : {}),
    });
  }
  return userPool;
}

function normalizeCognitoError(error) {
  const rawType = error?.code || error?.name || error?.__type || "";
  const code = typeof rawType === "string" ? rawType.split("#").pop() : "";
  return {
    ...error,
    code,
    name: code || error?.name || "",
    message: error?.message || "Authentication failed.",
  };
}

export function signInWithCognito(email, password) {
  return getUserPool()
    .then((pool) =>
      getCognitoSdk().then(({ CognitoUser, AuthenticationDetails }) => {
        const cognitoUser = new CognitoUser({
          Username: email,
          Pool: pool,
          ...(buildCookieStorage() ? { Storage: buildCookieStorage() } : {}),
        });
        const auth = new AuthenticationDetails({ Username: email, Password: password });
        return new Promise((resolve, reject) => {
          cognitoUser.authenticateUser(auth, {
            onSuccess: (result) => {
              clearLegacyCognitoWebStorage();
              resolve({
                accessToken: result.getAccessToken().getJwtToken(),
                idToken: result.getIdToken().getJwtToken(),
                refreshToken: result.getRefreshToken().getToken(),
              });
            },
            onFailure: (error) => reject(normalizeCognitoError(error)),
            newPasswordRequired: (_userAttributes, _requiredAttributes) => {
              // Resolve with a challenge object so Login.jsx can route to forced password change
              resolve({ challengeName: 'NEW_PASSWORD_REQUIRED', cognitoUser });
            },
          });
        });
      })
    )
    .catch((error) => Promise.reject(normalizeCognitoError(error)));
}

export function signUpWithCognito(email, password) {
  return getUserPool()
    .then((pool) =>
      getCognitoSdk().then(({ CognitoUserAttribute }) => {
        const attributes = [new CognitoUserAttribute({ Name: "email", Value: email })];
        return new Promise((resolve, reject) => {
          pool.signUp(email, password, attributes, [], (err, result) => {
            if (err) { reject(normalizeCognitoError(err)); return; }
            resolve(result?.user);
          });
        });
      })
    )
    .catch((error) => Promise.reject(normalizeCognitoError(error)));
}

export function confirmSignUpWithOtp(email, otp) {
  return getUserPool()
    .then((pool) =>
      getCognitoSdk().then(({ CognitoUser }) => {
        const cognitoUser = new CognitoUser({
          Username: email,
          Pool: pool,
          ...(buildCookieStorage() ? { Storage: buildCookieStorage() } : {}),
        });
        return new Promise((resolve, reject) => {
          cognitoUser.confirmRegistration(otp, true, (err, data) => {
            if (err) { reject(normalizeCognitoError(err)); return; }
            resolve(data);
          });
        });
      })
    )
    .catch((error) => Promise.reject(normalizeCognitoError(error)));
}

export function resendSignUpOtp(email) {
  return getUserPool()
    .then((pool) =>
      getCognitoSdk().then(({ CognitoUser }) => {
        const cognitoUser = new CognitoUser({
          Username: email,
          Pool: pool,
          ...(buildCookieStorage() ? { Storage: buildCookieStorage() } : {}),
        });
        return new Promise((resolve, reject) => {
          cognitoUser.resendConfirmationCode((err, data) => {
            if (err) { reject(normalizeCognitoError(err)); return; }
            resolve(data);
          });
        });
      })
    )
    .catch((error) => Promise.reject(normalizeCognitoError(error)));
}

export function startForgotPassword(email) {
  return getUserPool()
    .then((pool) =>
      getCognitoSdk().then(({ CognitoUser }) => {
        const cognitoUser = new CognitoUser({
          Username: email,
          Pool: pool,
          ...(buildCookieStorage() ? { Storage: buildCookieStorage() } : {}),
        });
        return new Promise((resolve, reject) => {
          cognitoUser.forgotPassword({
            onSuccess: resolve,
            onFailure: (error) => reject(normalizeCognitoError(error)),
            inputVerificationCode: (delivery) => resolve(delivery),
          });
        });
      })
    )
    .catch((error) => Promise.reject(normalizeCognitoError(error)));
}

export function confirmForgotPassword(email, otp, newPassword) {
  return getUserPool()
    .then((pool) =>
      getCognitoSdk().then(({ CognitoUser }) => {
        const cognitoUser = new CognitoUser({
          Username: email,
          Pool: pool,
          ...(buildCookieStorage() ? { Storage: buildCookieStorage() } : {}),
        });
        return new Promise((resolve, reject) => {
          cognitoUser.confirmPassword(otp, newPassword, {
            onSuccess: resolve,
            onFailure: (error) => reject(normalizeCognitoError(error)),
          });
        });
      })
    )
    .catch((error) => Promise.reject(normalizeCognitoError(error)));
}

export function globalSignOutCognito(email) {
  return getUserPool()
    .then((pool) =>
      getCognitoSdk().then(({ CognitoUser }) => {
        const cognitoUser = new CognitoUser({
          Username: email,
          Pool: pool,
          ...(buildCookieStorage() ? { Storage: buildCookieStorage() } : {}),
        });
        return new Promise((resolve, reject) => {
          cognitoUser.globalSignOut({
            onSuccess: resolve,
            onFailure: (error) => reject(normalizeCognitoError(error)),
          });
        });
      })
    )
    .catch((error) => Promise.reject(normalizeCognitoError(error)));
}

export function completeNewPassword(cognitoUser, newPassword) {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: (result) => {
        resolve({
          accessToken: result.getAccessToken().getJwtToken(),
          idToken: result.getIdToken().getJwtToken(),
          refreshToken: result.getRefreshToken().getToken(),
        });
      },
      onFailure: (error) => reject(normalizeCognitoError(error)),
    });
  });
}

/**
 * Refresh Cognito tokens using the stored refresh token.
 * Returns new { accessToken, idToken } on success, null on failure.
 */
export async function refreshCognitoTokens(email, refreshToken) {
  try {
    const pool = await getUserPool();
    const { CognitoUser, CognitoRefreshToken } = await getCognitoSdk();
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: pool,
      ...(buildCookieStorage() ? { Storage: buildCookieStorage() } : {}),
    });
    const token = new CognitoRefreshToken({ RefreshToken: refreshToken });
    return new Promise((resolve) => {
      cognitoUser.refreshSession(token, (err, session) => {
        if (err) { resolve(null); return; }
        resolve({
          accessToken: session.getAccessToken().getJwtToken(),
          idToken: session.getIdToken().getJwtToken(),
        });
      });
    });
  } catch {
    return null;
  }
}
