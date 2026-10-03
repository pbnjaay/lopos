// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentUser } from "../../api/auth"
import { ApiError, NetworkError } from "../../api/client"
import {
  getLocalCashSessionForRegister,
  localSessionToCurrentUser,
} from "../../db/sessions"
import type { CurrentUser } from "../../types/api"
import { storeCashRegisterId } from "../cash-session/storage"
import {
  OfflineCashSessionUnavailableError,
  getCurrentUserWithOfflineFallback,
} from "./queries"

vi.mock("../../api/auth", () => ({ getCurrentUser: vi.fn() }))
vi.mock("../../db/sessions", () => ({
  getLocalCashSessionForRegister: vi.fn(),
  localSessionToCurrentUser: vi.fn(),
}))

const user: CurrentUser = {
  id: 7,
  username: "caissier",
  first_name: "Awa",
  last_name: "Diop",
  email: "",
  is_staff: false,
}

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe("offline auth continuity", () => {
  it("keeps the authenticated server response when available", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user)

    await expect(getCurrentUserWithOfflineFallback()).resolves.toEqual(user)
    expect(getLocalCashSessionForRegister).not.toHaveBeenCalled()
  })

  it("restores a non-sensitive user identity after a network failure", async () => {
    storeCashRegisterId("register-id")
    vi.mocked(getCurrentUser).mockRejectedValue(new NetworkError())
    vi.mocked(getLocalCashSessionForRegister).mockResolvedValue({} as never)
    vi.mocked(localSessionToCurrentUser).mockReturnValue(user)

    await expect(getCurrentUserWithOfflineFallback()).resolves.toEqual(user)
    expect(getLocalCashSessionForRegister).toHaveBeenCalledWith("register-id")
  })

  it("does not bypass a rejected server authentication", async () => {
    const authError = new ApiError(403, { detail: "Non authentifié." })
    vi.mocked(getCurrentUser).mockRejectedValue(authError)

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBe(authError)
    expect(getLocalCashSessionForRegister).not.toHaveBeenCalled()
  })

  it("requires an existing local session when the server is unavailable", async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new NetworkError())

    await expect(getCurrentUserWithOfflineFallback()).rejects.toBeInstanceOf(
      OfflineCashSessionUnavailableError,
    )
  })
})
