import { describe, expect, test } from "bun:test"
import { Database } from "@/storage/db"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import * as TerminalSandbox from "@/platform-auth/terminal-sandbox"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { resetDatabase } from "../fixture/db"
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

function resetPlatformAuthTables() {
  Database.use((db) => {
    db.run("DELETE FROM platform_resource_usage")
    db.run("DELETE FROM platform_resource_quota")
    db.run("DELETE FROM platform_workspace_member")
    db.run("DELETE FROM platform_workspace")
    db.run("DELETE FROM platform_auth_session")
    db.run("DELETE FROM platform_auth_identity")
    db.run("DELETE FROM platform_password_reset_token")
    db.run("DELETE FROM platform_password_credential")
    db.run("DELETE FROM platform_account")
  })
  // Clean up workspace directories created by register() under the fallback root.
  const fallbackRoot = path.join(os.homedir(), "privated_data", "workspaces").replaceAll("\\", "/")
  try {
    rmSync(fallbackRoot, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function withEnv<T>(entries: Record<string, string | undefined>, run: () => T) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(entries)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return run()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe.serial("PlatformAuth", () => {
  test("registers accounts with workspace defaults and resolves sessions", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.register({
        email: " One@Example.COM ",
        name: "one_user",
        password: "password123",
      }),
    )

    expect(session.account.email).toBe("one@example.com")
    expect(session.account.name).toBe("one_user")
    expect(session.workspaces).toHaveLength(1)
    expect(session.workspaces[0]?.role).toBe("admin")
    expect(session.workspaces[0]?.slug).toBe("one_user")
    expect(session.workspaces[0]?.defaultEnvPath).toBe(`${path.join(os.homedir(), "privated_data", "workspaces").replaceAll("\\", "/")}/one_user`)
    const caseRoot = PlatformAuth.defaultWorkspaceCaseDirectory(session)!
    expect(caseRoot).toBe(`${session.workspaces[0]!.defaultEnvPath}/case`)
    expect(existsSync(session.workspaces[0]!.defaultEnvPath)).toBe(true)
    expect(existsSync(caseRoot)).toBe(true)

    const resolved = PlatformAuth.resolveSession(session.token)

    expect(resolved.account.id).toBe(session.account.id)
    expect(resolved.workspaces[0]?.id).toBe(session.workspaces[0]?.id)
    expect(PlatformAuth.login({ email: "one_user", password: "password123" }).account.id).toBe(session.account.id)
    expect(PlatformAuth.accountIdForPath(path.join(session.workspaces[0]!.defaultEnvPath, "proj", "out.csv"))).toBe(session.account.id)
    expect(PlatformAuth.accountIdForPath(os.tmpdir())).toBeUndefined()
  })

  test("provisions accounts idempotently and rejects identity or password conflicts", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const first = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.provision({
        email: " Gv@Example.COM ",
        name: "gv_user",
        password: "password123",
      }),
    )
    expect(first.created).toBe(true)
    expect(first.account.email).toBe("gv@example.com")
    expect(first.account.name).toBe("gv_user")
    expect(first.workspaces).toHaveLength(1)
    expect(existsSync(first.workspaces[0]!.defaultEnvPath)).toBe(true)

    const again = PlatformAuth.provision({
      email: "gv@example.com",
      name: "gv_user",
      password: "password123",
    })
    expect(again.created).toBe(false)
    expect(again.account.id).toBe(first.account.id)
    expect(again.token).not.toBe(first.token)
    expect(PlatformAuth.listAccounts().filter((item) => item.email === "gv@example.com")).toHaveLength(1)

    expect(() =>
      PlatformAuth.provision({
        email: "gv@example.com",
        name: "gv_user",
        password: "wrong-password",
      }),
    ).toThrow(PlatformAuth.PROVISION_PASSWORD_MISMATCH_MESSAGE)

    expect(() =>
      PlatformAuth.provision({
        email: "gv@example.com",
        name: "gv_other",
        password: "password123",
      }),
    ).toThrow(PlatformAuth.PROVISION_IDENTITY_CONFLICT_MESSAGE)

    expect(() =>
      PlatformAuth.provision({
        email: "other@example.com",
        name: "gv_user",
        password: "password123",
      }),
    ).toThrow(PlatformAuth.PROVISION_IDENTITY_CONFLICT_MESSAGE)
  })

  test("provision skips invite and email-code gates used by register", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    PlatformAuth.resetRegistrationEmailStateForTest()
    const { resetRegistrationConfigForTest, updateRegistrationConfig } = await import("@/platform-auth/registration-config")
    const { isMailAvailable } = await import("@/messaging/mail-config")
    await resetRegistrationConfigForTest()
    await updateRegistrationConfig({
      inviteRequired: true,
      fixedCode: "FIXED-CODE",
      fixedTtlDays: 7,
    })

    expect(() =>
      PlatformAuth.register({
        email: "gate@example.com",
        name: "gate_user",
        password: "password123",
      }),
    ).toThrow("当前开启注册审核")

    const previous = {
      ONECODE_SMTP_PASS: process.env.ONECODE_SMTP_PASS,
      ONECODE_SMTP_TRANSPORT: process.env.ONECODE_SMTP_TRANSPORT,
    }
    process.env.ONECODE_SMTP_PASS = "test-smtp-pass"
    process.env.ONECODE_SMTP_TRANSPORT = "memory"
    try {
      expect(isMailAvailable()).toBe(true)
      const session = PlatformAuth.provision({
        email: "gate@example.com",
        name: "gate_user",
        password: "password123",
      })
      expect(session.created).toBe(true)
      expect(session.account.email).toBe("gate@example.com")
    } finally {
      await resetRegistrationConfigForTest()
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("provision token is optional unless ONECODE_PROVISION_TOKEN is set", () => {
    withEnv({ ONECODE_PROVISION_TOKEN: undefined, OPENCODE_PROVISION_TOKEN: undefined }, () => {
      expect(() => PlatformAuth.assertProvisionToken(undefined)).not.toThrow()
    })
    withEnv({ ONECODE_PROVISION_TOKEN: "secret-token", OPENCODE_PROVISION_TOKEN: undefined }, () => {
      expect(() => PlatformAuth.assertProvisionToken(undefined)).toThrow(PlatformAuth.PROVISION_TOKEN_REQUIRED_MESSAGE)
      expect(() => PlatformAuth.assertProvisionToken("wrong")).toThrow(PlatformAuth.PROVISION_TOKEN_INVALID_MESSAGE)
      expect(() => PlatformAuth.assertProvisionToken("secret-token")).not.toThrow()
    })
  })

  test("rejects invalid or duplicate account slugs before creating workspace dirs", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    expect(() =>
      PlatformAuth.register({
        email: "bad@example.com",
        name: "Bad Name",
        password: "password123",
      }),
    ).toThrow("账户名须为")

    expect(() =>
      PlatformAuth.register({
        email: "root@example.com",
        name: "root",
        password: "password123",
      }),
    ).toThrow("系统保留名")

    const first = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.register({
        email: "first@example.com",
        name: "mk_han",
        password: "password123",
      }),
    )
    expect(first.workspaces[0]?.defaultEnvPath).toBe(`${path.join(os.homedir(), "privated_data", "workspaces").replaceAll("\\", "/")}/mk_han`)

    expect(() =>
      PlatformAuth.register({
        email: "second@example.com",
        name: "MK_HAN",
        password: "password123",
      }),
    ).toThrow("该账户名已被占用")
  })

  test("registers workspaces under ONECODE_EXTRA_PATH when configured", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const extra = path.join(process.cwd(), `.opencode-test-extra-${crypto.randomUUID()}`)
    try {
      const session = withEnv({ ONECODE_EXTRA_PATH: extra }, () =>
        PlatformAuth.register({
          email: "extra@example.com",
          name: "extra_user",
          password: "password123",
        }),
      )

      const root = path.resolve(extra, "workspaces").replaceAll("\\", "/")
      expect(session.workspaces[0]?.defaultEnvPath.replaceAll("\\", "/")).toBe(`${root}/extra_user`)
      expect(existsSync(session.workspaces[0]!.defaultEnvPath)).toBe(true)
      expect(existsSync(PlatformAuth.defaultWorkspaceCaseDirectory(session)!)).toBe(true)
      } finally {
      rmSync(extra, { recursive: true, force: true })
    }
  })

  test("changes passwords and records account resource usage", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = PlatformAuth.register({
      email: "usage@example.com",
      name: "usage_user",
      password: "password123",
    })

    expect(
      PlatformAuth.changePassword({
        accountId: session.account.id,
        currentPassword: "password123",
        newPassword: "changed123",
      }),
    ).toBe(true)
    expect(() => PlatformAuth.login({ email: "usage@example.com", password: "password123" })).toThrow(
      PlatformAuth.INVALID_CREDENTIALS_MESSAGE,
    )
    expect(PlatformAuth.login({ email: "usage@example.com", password: "changed123" }).account.id).toBe(
      session.account.id,
    )

    const usage = PlatformAuth.recordUsage({
      workspaceId: session.workspaces[0]!.id,
      accountId: session.account.id,
      resourceType: "tokens",
      amount: 42,
      unit: "count",
      sourceId: "session-1",
      sourceType: "chat",
    })

    expect(usage.resourceType).toBe("tokens")
    expect(PlatformAuth.listUsage({ accountId: session.account.id })).toEqual([usage])
    expect(PlatformAuth.detail(session.account.id).usage).toEqual([usage])
  })

  test("freezes accounts, revokes sessions, and restores login after unfreeze", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.register({
        email: "frozen@example.com",
        name: "frozen_user",
        password: "password123",
      }),
    )

    expect(PlatformAuth.resolveSession(session.token).account.id).toBe(session.account.id)

    const frozen = PlatformAuth.setAccountStatus({ accountId: session.account.id, status: "frozen" })
    expect(frozen.status).toBe("frozen")
    expect(() => PlatformAuth.resolveSession(session.token)).toThrow("session expired")
    expect(() => PlatformAuth.login({ email: "frozen_user", password: "password123" })).toThrow(
      PlatformAuth.ACCOUNT_FROZEN_MESSAGE,
    )

    const active = PlatformAuth.setAccountStatus({ accountId: session.account.id, status: "active" })
    expect(active.status).toBe("active")
    expect(PlatformAuth.login({ email: "frozen_user", password: "password123" }).account.id).toBe(session.account.id)
  })

  test("adminDeleteAccount freezes then hard-deletes workspace and account", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.register({
        email: "delete-me@example.com",
        name: "delete_me",
        password: "password123",
      }),
    )
    const root = session.workspaces[0]!.defaultEnvPath
    expect(existsSync(root)).toBe(true)

    expect(PlatformAuth.adminDeleteAccount({ accountId: session.account.id })).toBe(true)
    expect(existsSync(root)).toBe(false)
    expect(PlatformAuth.listAccounts().some((item) => item.id === session.account.id)).toBe(false)
    expect(() => PlatformAuth.login({ email: "delete_me", password: "password123" })).toThrow(
      PlatformAuth.INVALID_CREDENTIALS_MESSAGE,
    )
  })

  test("requires invite codes when registration review is enabled", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    const {
      createRandomInvite,
      resetRegistrationConfigForTest,
      updateRegistrationConfig,
    } = await import("@/platform-auth/registration-config")
    await resetRegistrationConfigForTest()

    await updateRegistrationConfig({
      inviteRequired: true,
      fixedCode: "FIXED-CODE",
      fixedTtlDays: 7,
    })

    expect(() =>
      PlatformAuth.register({
        email: "no-invite@example.com",
        name: "no_invite",
        password: "password123",
      }),
    ).toThrow("当前开启注册审核")

    expect(() =>
      PlatformAuth.register({
        email: "bad-invite@example.com",
        name: "bad_invite",
        password: "password123",
        inviteCode: "WRONG",
      }),
    ).toThrow("邀请码无效或已过期")

    const ok = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.register({
        email: "ok-invite@example.com",
        name: "ok_invite",
        password: "password123",
        inviteCode: "fixed-code",
      }),
    )
    expect(ok.account.name).toBe("ok_invite")

    const random = await createRandomInvite()
    const once = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.register({
        email: "random-invite@example.com",
        name: "random_invite",
        password: "password123",
        inviteCode: random.code,
      }),
    )
    expect(once.account.name).toBe("random_invite")
    expect(() =>
      PlatformAuth.register({
        email: "reuse-invite@example.com",
        name: "reuse_invite",
        password: "password123",
        inviteCode: random.code,
      }),
    ).toThrow("邀请码无效或已过期")

    await updateRegistrationConfig({ inviteRequired: false })
    const open = withEnv({ ONECODE_EXTRA_PATH: undefined }, () =>
      PlatformAuth.register({
        email: "open-reg@example.com",
        name: "open_reg",
        password: "password123",
      }),
    )
    expect(open.account.name).toBe("open_reg")
    await resetRegistrationConfigForTest()
  })

  test("rejects email password-reset requests until the mail channel is ready", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    PlatformAuth.resetPasswordResetCooldownForTest()

    PlatformAuth.register({
      email: "reset@example.com",
      name: "reset_user",
      password: "password123",
    })

    await expect(PlatformAuth.requestPasswordReset({ email: "RESET@example.com" })).rejects.toThrow(
      "邮件找回未配置，请联系管理员",
    )
  })

  test("allows admin-created reset tokens to change passwords", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = PlatformAuth.register({
      email: "reset@example.com",
      name: "reset_user",
      password: "password123",
    })

    const credential = PlatformAuth.createAdminPasswordReset({ accountId: session.account.id })
    expect(credential.resetToken).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(credential.expiresAt).toBeGreaterThan(Date.now())

    expect(
      PlatformAuth.resetPassword({
        token: credential.resetToken.toLowerCase(),
        newPassword: "changed123",
      }),
    ).toBe(true)

    expect(() =>
      PlatformAuth.resetPassword({
        token: credential.resetToken,
        newPassword: "another123",
      }),
    ).toThrow(PlatformAuth.INVALID_RESET_TOKEN_MESSAGE)

    const next = PlatformAuth.login({ email: "reset@example.com", password: "changed123" })
    expect(next.account.id).toBe(session.account.id)
  })

  test("sends email password-reset codes when SMTP memory transport is configured", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    PlatformAuth.resetPasswordResetCooldownForTest()
    const { resetMailOutboxForTest, listMailOutboxForTest } = await import("@/messaging/smtp")
    resetMailOutboxForTest()

    PlatformAuth.register({
      email: "mail-reset@example.com",
      name: "mail_reset_user",
      password: "password123",
    })

    const previous = {
      ONECODE_SMTP_PASS: process.env.ONECODE_SMTP_PASS,
      ONECODE_SMTP_TRANSPORT: process.env.ONECODE_SMTP_TRANSPORT,
    }
    process.env.ONECODE_SMTP_PASS = "test-smtp-pass"
    process.env.ONECODE_SMTP_TRANSPORT = "memory"
    try {
      const result = await PlatformAuth.requestPasswordReset({ email: "mail-reset@example.com" })
      expect(result).toEqual({ requested: true, retryAfterMs: PlatformAuth.PASSWORD_RESET_REQUEST_COOLDOWN_MS })
      expect(result.resetToken).toBeUndefined()

      const mails = listMailOutboxForTest()
      expect(mails).toHaveLength(1)
      expect(mails[0]?.to).toBe("mail-reset@example.com")
      const match = mails[0]?.text.match(/验证码：([A-Z0-9-]{9})/)
      expect(match?.[1]).toBeTruthy()

      expect(
        PlatformAuth.resetPassword({
          token: match![1]!,
          newPassword: "mailchanged1",
        }),
      ).toBe(true)

      const next = PlatformAuth.login({ email: "mail-reset@example.com", password: "mailchanged1" })
      expect(next.account.email).toBe("mail-reset@example.com")
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("requires registration email code only when SMTP is available", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    PlatformAuth.resetRegistrationEmailStateForTest()
    const { resetMailOutboxForTest, listMailOutboxForTest } = await import("@/messaging/smtp")
    const { publicRegistrationGate } = await import("@/platform-auth/registration-config")
    const { isMailAvailable } = await import("@/messaging/mail-config")
    resetMailOutboxForTest()

    const previous = {
      ONECODE_SMTP_PASS: process.env.ONECODE_SMTP_PASS,
      ONECODE_SMTP_TRANSPORT: process.env.ONECODE_SMTP_TRANSPORT,
    }

    delete process.env.ONECODE_SMTP_PASS
    delete process.env.ONECODE_SMTP_TRANSPORT
    try {
      // Without SMTP pass, gate hides verification and register works without a code.
      if (!isMailAvailable()) {
        expect(await publicRegistrationGate()).toMatchObject({ emailVerificationRequired: false })
        expect(() =>
          PlatformAuth.register({
            email: "not-an-email",
            name: "bad_email_user",
            password: "password123",
          }),
        ).toThrow("请填写有效邮箱")

        const open = PlatformAuth.register({
          email: "open-reg@example.com",
          name: "open_reg_user",
          password: "password123",
        })
        expect(open.account.email).toBe("open-reg@example.com")
      }

      process.env.ONECODE_SMTP_PASS = "test-smtp-pass"
      process.env.ONECODE_SMTP_TRANSPORT = "memory"
      expect(isMailAvailable()).toBe(true)
      expect(await publicRegistrationGate()).toMatchObject({ emailVerificationRequired: true })

      expect(() =>
        PlatformAuth.register({
          email: "verify-reg@example.com",
          name: "verify_reg_user",
          password: "password123",
        }),
      ).toThrow(PlatformAuth.REGISTRATION_EMAIL_REQUIRED_MESSAGE)

      const sent = await PlatformAuth.requestRegistrationEmailCode({ email: "verify-reg@example.com" })
      expect(sent).toEqual({
        requested: true,
        retryAfterMs: PlatformAuth.REGISTRATION_EMAIL_REQUEST_COOLDOWN_MS,
      })
      const mails = listMailOutboxForTest()
      expect(mails).toHaveLength(1)
      const match = mails[0]?.text.match(/验证码：([A-Z0-9-]{9})/)
      expect(match?.[1]).toBeTruthy()

      expect(() =>
        PlatformAuth.register({
          email: "verify-reg@example.com",
          name: "verify_reg_user",
          password: "password123",
          emailCode: "AAAA-BBBB",
        }),
      ).toThrow(PlatformAuth.INVALID_REGISTRATION_EMAIL_CODE_MESSAGE)

      const session = PlatformAuth.register({
        email: "verify-reg@example.com",
        name: "verify_reg_user",
        password: "password123",
        emailCode: match![1]!,
      })
      expect(session.account.email).toBe("verify-reg@example.com")

      PlatformAuth.resetRegistrationEmailStateForTest()
      await expect(PlatformAuth.requestRegistrationEmailCode({ email: "verify-reg@example.com" })).rejects.toThrow(
        "该邮箱已注册",
      )
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      PlatformAuth.resetRegistrationEmailStateForTest()
    }
  })

  test("allows registration without an email code when SMTP connect times out", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    PlatformAuth.resetRegistrationEmailStateForTest()

    const previous = {
      ONECODE_SMTP_PASS: process.env.ONECODE_SMTP_PASS,
      ONECODE_SMTP_TRANSPORT: process.env.ONECODE_SMTP_TRANSPORT,
    }
    process.env.ONECODE_SMTP_PASS = "test-smtp-pass"
    process.env.ONECODE_SMTP_TRANSPORT = "fail-timeout"
    try {
      expect(() =>
        PlatformAuth.register({
          email: "timeout-reg@example.com",
          name: "timeout_reg_user",
          password: "password123",
        }),
      ).toThrow(PlatformAuth.REGISTRATION_EMAIL_REQUIRED_MESSAGE)

      const sent = await PlatformAuth.requestRegistrationEmailCode({ email: "timeout-reg@example.com" })
      expect(sent).toEqual({
        requested: false,
        smtpUnreachable: true,
        retryAfterMs: PlatformAuth.REGISTRATION_EMAIL_REQUEST_COOLDOWN_MS,
      })

      const session = PlatformAuth.register({
        email: "timeout-reg@example.com",
        name: "timeout_reg_user",
        password: "password123",
      })
      expect(session.account.email).toBe("timeout-reg@example.com")
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      PlatformAuth.resetRegistrationEmailStateForTest()
    }
  })

  test("does not skip password reset when SMTP connect times out", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    PlatformAuth.resetPasswordResetCooldownForTest()
    PlatformAuth.resetRegistrationEmailStateForTest()

    PlatformAuth.register({
      email: "timeout-reset@example.com",
      name: "timeout_reset_user",
      password: "password123",
    })

    const previous = {
      ONECODE_SMTP_PASS: process.env.ONECODE_SMTP_PASS,
      ONECODE_SMTP_TRANSPORT: process.env.ONECODE_SMTP_TRANSPORT,
    }
    process.env.ONECODE_SMTP_PASS = "test-smtp-pass"
    process.env.ONECODE_SMTP_TRANSPORT = "fail-timeout"
    try {
      await expect(PlatformAuth.requestPasswordReset({ email: "timeout-reset@example.com" })).rejects.toThrow(
        PlatformAuth.PASSWORD_RESET_SMTP_UNREACHABLE_MESSAGE,
      )

      expect(() =>
        PlatformAuth.resetPassword({
          token: "AAAA-BBBB",
          newPassword: "changed123",
        }),
      ).toThrow(PlatformAuth.INVALID_RESET_TOKEN_MESSAGE)

      const next = PlatformAuth.login({ email: "timeout-reset@example.com", password: "password123" })
      expect(next.account.email).toBe("timeout-reset@example.com")
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("locks login after repeated failures using admin-aligned cooldown", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    PlatformAuth.register({
      email: "lock@example.com",
      name: "lock_user",
      password: "password123",
    })

    expect(PlatformAuth.loginLockoutMs(1)).toBe(0)
    expect(PlatformAuth.loginLockoutMs(2)).toBe(0)
    expect(PlatformAuth.loginLockoutMs(3)).toBe(5_000)
    expect(PlatformAuth.loginLockoutMs(8)).toBe(5_000)

    expect(() => PlatformAuth.login({ email: "lock@example.com", password: "wrong" })).toThrow(
      PlatformAuth.INVALID_CREDENTIALS_MESSAGE,
    )
    expect(() => PlatformAuth.login({ email: "missing@example.com", password: "wrong" })).toThrow(
      PlatformAuth.INVALID_CREDENTIALS_MESSAGE,
    )
    expect(() => PlatformAuth.login({ email: "lock@example.com", password: "wrong-2" })).toThrow(
      PlatformAuth.INVALID_CREDENTIALS_MESSAGE,
    )

    try {
      PlatformAuth.login({ email: "lock@example.com", password: "wrong-again" })
      throw new Error("expected lockout")
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformAuth.LoginFailedError)
      expect((error as PlatformAuth.LoginFailedError).message).toContain("尝试次数过多")
      expect((error as PlatformAuth.LoginFailedError).retryAfterMs).toBe(5_000)
    }

    expect(() => PlatformAuth.login({ email: "lock@example.com", password: "password123" })).toThrow(
      /尝试次数过多/,
    )

    // After cooldown, failure count resets — wrong password is a normal credential error again.
    const lockPath = path.join(Global.Path.data, "platform-login-lock.json")
    writeFileSync(
      lockPath,
      `${JSON.stringify({ "lock@example.com": { failures: 3, lockedUntil: Date.now() - 1_000 } }, null, 2)}\n`,
      { mode: 0o600 },
    )
    expect(() => PlatformAuth.login({ email: "lock@example.com", password: "wrong-after-cooldown" })).toThrow(
      PlatformAuth.INVALID_CREDENTIALS_MESSAGE,
    )
    expect(PlatformAuth.login({ email: "lock@example.com", password: "password123" }).account.email).toBe(
      "lock@example.com",
    )
  })

  test("honors requested directories outside the account workspace for host uploads", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = PlatformAuth.register({
      email: "scoped@example.com",
      name: "scoped_user",
      password: "password123",
    })
    const root = session.workspaces[0]!.defaultEnvPath

    expect(PlatformAuth.canAccessPath(session, "/data/case")).toBe(true)
    expect(PlatformAuth.canWritePath(session, "/data/case")).toBe(false)
    expect(PlatformAuth.canWritePath(session, `${root}/case`)).toBe(true)
    expect(PlatformAuth.canWritePath(session, "/tmp/host-upload-target")).toBe(true)
    expect(PlatformAuth.resolveDirectoryForSession(session, "/data/case")).toBe(path.resolve("/data/case"))
    expect(PlatformAuth.resolveDirectoryForSession(session, `${root}/case-a`)).toBe(path.resolve(`${root}/case-a`))
    expect(PlatformAuth.resolveDirectoryForSession(session, "/tmp/host-upload-target")).toBe(
      path.resolve("/tmp/host-upload-target"),
    )
    expect(session.capabilities.sharedCasesRoot).toBe(PlatformAuth.sharedCasesRoot())
  })

  test("matches account workspace paths with Windows drive casing", async () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 1000,
      account: {
        id: "account",
        email: "account@example.com",
        name: "acct_demo",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "workspace",
          slug: "workspace",
          name: "wrk_demo",
          defaultEnvPath: "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
          role: "admin",
        },
      ],
      capabilities: { terminal: false },
    }

    if (process.platform === "win32") {
      expect(PlatformAuth.canAccessPath(session, "D:\\Data\\guest_data\\workspaces\\liu0218dong-0cc8f29e")).toBe(true)
      expect(PlatformAuth.canAccessPath(session, "D:\\Data\\guest_data\\workspaces\\liu0218dong-0cc8f29e\\case")).toBe(true)
      return
    }

    expect(PlatformAuth.canAccessPath(session, "/outside/data/guest_data/workspaces/liu0218dong-0cc8f29e")).toBe(false)
  })

  test("filters project lists to the account workspace", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = PlatformAuth.register({
      email: "projects@example.com",
      name: "projects_user",
      password: "password123",
    })
    const root = session.workspaces[0]!.defaultEnvPath
    const projects = PlatformAuth.filterAccessibleProjects(session, [
      {
        worktree: "/data/guest_data/workspaces/other-user",
        sandboxes: ["/data/guest_data/workspaces/other-user/case"],
      },
      {
        worktree: root,
        sandboxes: [`${root}/case-a`, "/data/guest_data/workspaces/other-user/case-b", "/data/case"],
      },
    ])

    expect(projects).toEqual([
      {
        worktree: root,
        sandboxes: [`${root}/case-a`, "/data/case"],
      },
    ])
  })

  test("includes shared cases projects for logged-in accounts", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const session = PlatformAuth.register({
      email: "shared-cases@example.com",
      name: "shared_cases_user",
      password: "password123",
    })
    const root = session.workspaces[0]!.defaultEnvPath
    const projects = PlatformAuth.filterAccessibleProjects(session, [
      {
        worktree: "/data/case",
        sandboxes: ["/data/case/demo"],
      },
      {
        worktree: "/data/guest_data/workspaces/other-user",
        sandboxes: ["/data/guest_data/workspaces/other-user/case"],
      },
      {
        worktree: root,
        sandboxes: [`${root}/case-a`],
      },
    ])

    expect(projects).toEqual([
      {
        worktree: "/data/case",
        sandboxes: ["/data/case/demo"],
      },
      {
        worktree: root,
        sandboxes: [`${root}/case-a`],
      },
    ])
  })

  test("disables terminal access for platform account sessions", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv({ ONECODE_TERMINAL_ISOLATION: "disabled" }, () => {
      const session = PlatformAuth.register({
        email: "terminal@example.com",
        name: "terminal_user",
        password: "password123",
      })

      expect(PlatformAuth.canUseTerminal(undefined)).toBe(true)
      expect(PlatformAuth.canUseTerminal(session)).toBe(false)
      expect(session.capabilities.terminal).toBe(false)
      expect(session.capabilities.terminalUnavailableReason).toBe("disabled")
      expect(session.capabilities.sharedCasesRoot).toBe(PlatformAuth.sharedCasesRoot())
      expect(session.capabilities.terminalInstallCommands?.length).toBeGreaterThan(0)
    })
  })

  test("defaults to native terminal isolation on Windows", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv({ ONECODE_TERMINAL_ISOLATION: undefined, OPENCODE_TERMINAL_ISOLATION: undefined }, () => {
      const previous = process.platform
      Object.defineProperty(process, "platform", { value: "win32" })
      try {
        expect(PlatformAuth.terminalIsolationMode()).toBe("native")
        const session = PlatformAuth.register({
          email: "win-terminal@example.com",
          name: "windows_terminal",
          password: "password123",
        })
        expect(PlatformAuth.canUseTerminal(session)).toBe(true)
        expect(session.capabilities.terminal).toBe(true)
        expect(session.capabilities.terminalIsolation).toBe("native")

        const root = session.workspaces[0]!.defaultEnvPath
        const prepared = TerminalSandbox.prepare({
          session,
          command: "powershell.exe",
          args: [],
          cwd: `${root}/case`,
          env: { PATH: "/usr/bin", TERM: "xterm" },
        })
        expect(prepared.sandboxed).toBe(false)
        expect(path.resolve(prepared.cwd)).toBe(path.resolve(root, "case"))
      } finally {
        Object.defineProperty(process, "platform", { value: previous })
      }
    })
  })

  test("remote leaf PTY is a host shell without platform isolation", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    const previous = Flag.OPENCODE_WORKSPACE_ID
    Flag.OPENCODE_WORKSPACE_ID = "wrk_leaf"
    try {
      withEnv(
        {
          ONECODE_TERMINAL_ISOLATION: "bubblewrap",
          OPENCODE_TERMINAL_ISOLATION: "bubblewrap",
          ONECODE_BWRAP_PATH: "bwrap",
          ONECODE_BWRAP_PROBE: "0",
        },
        () => {
          const session = PlatformAuth.register({
            email: "leaf-terminal@example.com",
            name: "leaf_terminal",
            password: "password123",
          })
          const cwd = path.resolve(os.tmpdir(), `onecode-leaf-pty-${process.pid}`)
          mkdirSync(cwd, { recursive: true })
          try {
            expect(TerminalSandbox.isRemoteLeafTerminal()).toBe(true)
            const prepared = TerminalSandbox.prepare({
              session,
              command: "/bin/bash",
              args: ["-l"],
              cwd,
              env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
            })
            expect(prepared.sandboxed).toBe(false)
            expect(prepared.command).toBe("/bin/bash")
            expect(path.resolve(prepared.cwd)).toBe(cwd)
          } finally {
            rmSync(cwd, { recursive: true, force: true })
          }
        },
      )
    } finally {
      Flag.OPENCODE_WORKSPACE_ID = previous
    }
  })

  test("control-plane PTY for an off-host remote cwd skips platform isolation", async () => {
    await resetDatabase()
    resetPlatformAuthTables()
    const previous = Flag.OPENCODE_WORKSPACE_ID
    Flag.OPENCODE_WORKSPACE_ID = undefined
    try {
      withEnv(
        {
          ONECODE_TERMINAL_ISOLATION: "bubblewrap",
          OPENCODE_TERMINAL_ISOLATION: "bubblewrap",
          ONECODE_BWRAP_PATH: "bwrap",
          ONECODE_BWRAP_PROBE: "0",
        },
        () => {
          const session = PlatformAuth.register({
            email: "offhost-terminal@example.com",
            name: "offhost_terminal",
            password: "password123",
          })
          const remoteCwd = "/home/onescience2026/test_dir"
          expect(TerminalSandbox.isOffHostRemoteCwd(session, remoteCwd)).toBe(true)
          const prepared = TerminalSandbox.prepare({
            session,
            command: "/bin/bash",
            args: ["-l"],
            cwd: remoteCwd,
            env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
          })
          expect(prepared.sandboxed).toBe(false)
          expect(prepared.command).toBe("/bin/bash")
        },
      )
    } finally {
      Flag.OPENCODE_WORKSPACE_ID = previous
    }
  })

  test("defaults to bubblewrap terminal isolation on Linux when bwrap is usable", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "0",
        ONECODE_ACCEL_HOST: "0",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("bubblewrap")
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("falls back to native shared terminal when bubblewrap is unavailable", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "0",
        ONECODE_ACCEL_HOST: "0",
        ONECODE_BWRAP_PATH: "/nonexistent/bwrap",
        ONECODE_BWRAP_PROBE: undefined,
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("native")
          const session = PlatformAuth.register({
            email: "terminal-fallback@example.com",
            name: "terminal_fallback",
            password: "password123",
          })
          expect(PlatformAuth.canUseTerminal(session)).toBe(true)
          expect(session.capabilities.terminal).toBe(true)
          expect(session.capabilities.terminalIsolation).toBe("native")
          expect(session.capabilities.terminalUnavailableReason).toBeUndefined()
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("soft-falls back to native when bubblewrap is explicitly requested but missing", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "/nonexistent/bwrap",
        ONECODE_BWRAP_PROBE: undefined,
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("native")
          expect(PlatformAuth.canUseTerminal({} as never)).toBe(true)
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("defaults to native on bare metal when accelerators exist but docker is unavailable", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "0",
        ONECODE_ACCEL_HOST: "1",
        ONECODE_DOCKER_PATH: "/nonexistent/docker-binary",
        OPENCODE_DOCKER_PATH: undefined,
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("native")
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("defaults to docker on bare metal when accelerators and docker are available", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "0",
        ONECODE_ACCEL_HOST: "1",
        ONECODE_DOCKER_PATH: process.execPath,
        ONECODE_DOCKER_PROBE: "0",
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("docker")
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("prefers bubblewrap on bare metal without accelerators even when docker exists", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "0",
        ONECODE_ACCEL_HOST: "0",
        ONECODE_DOCKER_PATH: process.execPath,
        ONECODE_DOCKER_PROBE: "0",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("bubblewrap")
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("treats permission-denied docker as unavailable and falls back for accelerators", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "0",
        ONECODE_ACCEL_HOST: "1",
        // Real node/bun binary cannot answer `docker info` → probe fails.
        ONECODE_DOCKER_PATH: process.execPath,
        ONECODE_DOCKER_PROBE: undefined,
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("native")
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("falls back to native terminal isolation inside a container when bubblewrap is unavailable", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "1",
        ONECODE_BWRAP_PATH: "/nonexistent/bwrap",
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("native")
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("uses native terminal isolation inside a container even when bubblewrap is available", async () => {
    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: undefined,
        OPENCODE_TERMINAL_ISOLATION: undefined,
        ONECODE_CONTAINER_RUNTIME: "1",
      },
      () => {
        const previous = process.platform
        Object.defineProperty(process, "platform", { value: "linux" })
        try {
          expect(PlatformAuth.terminalIsolationMode()).toBe("native")
          expect(PlatformAuth.canUseTerminal({} as never)).toBe(true)
        } finally {
          Object.defineProperty(process, "platform", { value: previous })
        }
      },
    )
  })

  test("enables terminal access when sandbox isolation is configured", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "docker",
        ONECODE_DOCKER_PATH: process.execPath,
        ONECODE_DOCKER_PROBE: "0",
        DOCKER_HOST: undefined,
        DOCKER_CONTEXT: undefined,
      },
      () => {
      const session = PlatformAuth.register({
        email: "terminal-enabled@example.com",
        name: "terminal_enabled",
        password: "password123",
      })
      const root = session.workspaces[0]!.defaultEnvPath
      const sandbox = TerminalSandbox.prepare({
        session,
        command: "/bin/bash",
        args: ["-lc", "pwd"],
        cwd: `${root}/case`,
        env: {
          PATH: "/usr/bin:/bin",
          TERM: "xterm",
          DOCKER_HOST: "tcp://attacker.example:2375",
          OPENCODE_SERVER_PASSWORD: "secret",
        },
      })

      expect(PlatformAuth.canUseTerminal(session)).toBe(true)
      expect(session.capabilities).toEqual({
        terminal: true,
        terminalIsolation: "docker",
        sharedCasesRoot: PlatformAuth.sharedCasesRoot(),
      })
      expect(sandbox.command).toBe(process.execPath)
      expect(sandbox.args).toContain("run")
      expect(sandbox.args).toContain("--volume")
      // Accelerator passthrough is on by default; NVIDIA --gpus only when host has nvidia nodes.
      expect(sandbox.args).toContain("--group-add")
      expect(sandbox.args).toContain("video")
      expect(sandbox.args).toContain("render")
      expect(sandbox.args.join(" ")).not.toContain("OPENCODE_SERVER_PASSWORD")
      expect(sandbox.args.join(" ")).toContain("/bin/bash")
      expect(sandbox.env.DOCKER_HOST).toBeUndefined()
    })
  })

  test("bubblewrap terminal sandbox binds NVIDIA and DCU accelerator devices", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
        ONECODE_TERMINAL_SANDBOX_GPU: "1",
        ONECODE_TERMINAL_SANDBOX_DEV_BIND: "/dev/nvidia0;/dev/nvidiactl",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-gpu@example.com",
          name: "terminal_gpu",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-l"],
          cwd: root,
          env: {
            PATH: "/usr/bin:/bin",
            TERM: "xterm",
            CUDA_VISIBLE_DEVICES: "0,1",
            HIP_VISIBLE_DEVICES: "0",
          },
          interactive: true,
        })

        expect(sandbox.sandboxed).toBe(true)
        expect(sandbox.command).toBe("bwrap")
        const joined = sandbox.args.join(" ")
        // Non-root multi-tenant default keeps userns; CUDA usually needs docker isolation instead.
        expect(joined).toContain("--unshare-all")
        expect(joined).toContain("--share-net")
        // Private /dev first, then host accelerator nodes (bwrap --dev does not expose them).
        expect(joined).toContain("--dev /dev")
        expect(joined).toContain("--dev-bind-try /dev/nvidia0 /dev/nvidia0")
        expect(joined).toContain("--dev-bind-try /dev/nvidiactl /dev/nvidiactl")
        // Hygon DCU / ROCm
        expect(joined).toContain("--dev-bind-try /dev/kfd /dev/kfd")
        expect(joined).toContain("--dev-bind-try /dev/mkfd /dev/mkfd")
        expect(joined).toContain("--dev-bind-try /dev/dri /dev/dri")
        // Default skips --size/--tmpfs /dev/shm (breaks older bwrap: Unknown option --size).
        expect(joined).not.toContain("--size")
        expect(joined).not.toContain("--tmpfs /dev/shm")
        expect(joined).toContain("--setenv CUDA_VISIBLE_DEVICES 0,1")
        expect(joined).toContain("--setenv HIP_VISIBLE_DEVICES 0")
        expect(TerminalSandbox.bwrapUnshareArgs()).toEqual(["--unshare-all", "--share-net"])
      },
    )
  })

  test("bubblewrap can skip userns only when explicitly requested", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
        ONECODE_TERMINAL_SANDBOX_USERNS: "0",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-nouserns@example.com",
          name: "terminal_nouserns",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-l"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expect(sandbox.args.join(" ")).toContain("--unshare-pid")
        expect(sandbox.args.join(" ")).not.toContain("--unshare-all")
        expect(sandbox.args.join(" ")).not.toContain("--unshare-net")
        expect(TerminalSandbox.bwrapUnshareArgs()).toEqual([
          "--unshare-pid",
          "--unshare-ipc",
          "--unshare-uts",
          "--unshare-cgroup",
        ])
      },
    )
  })

  test("bubblewrap can isolate network when SHARE_NET is disabled", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
        ONECODE_TERMINAL_SANDBOX_SHARE_NET: "0",
      },
      () => {
        expect(TerminalSandbox.bwrapShareHostNetwork()).toBe(false)
        expect(TerminalSandbox.bwrapUnshareArgs()).toEqual(["--unshare-all"])
        const session = PlatformAuth.register({
          email: "terminal-nonet@example.com",
          name: "terminal_nonet",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-l"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expect(sandbox.args.join(" ")).toContain("--unshare-all")
        expect(sandbox.args.join(" ")).not.toContain("--share-net")
      },
    )
  })

  test("can disable accelerator passthrough for bubblewrap and docker sandboxes", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
        ONECODE_TERMINAL_SANDBOX_GPU: "0",
        ONECODE_TERMINAL_SANDBOX_DEV_BIND: "/dev/nvidia0;/dev/kfd",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-nogpu@example.com",
          name: "terminal_nogpu",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-l"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expect(sandbox.args.join(" ")).not.toContain("/dev/nvidia0")
        expect(sandbox.args.join(" ")).not.toContain("/dev/kfd")
        expect(TerminalSandbox.hostAcceleratorDevBinds()).toEqual([])
        expect(TerminalSandbox.hostGpuDevBinds()).toEqual([])
      },
    )

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "docker",
        ONECODE_DOCKER_PATH: process.execPath,
        ONECODE_DOCKER_PROBE: "0",
        ONECODE_TERMINAL_SANDBOX_GPU: "0",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-docker-nogpu@example.com",
          name: "terminal_docker_nogpu",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-lc", "pwd"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expect(sandbox.args).not.toContain("--gpus")
        expect(sandbox.args.join(" ")).not.toContain("--device=")
      },
    )
  })

  test("sandbox HOME is workspace root so ~/default is the project prompt", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-home@example.com",
          name: "terminal_home",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-l"],
          cwd: `${root}/default`,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        const home = TerminalSandbox.sandboxHomePath(root)
        expect(home).toBe(path.resolve(root).replaceAll("\\", "/"))
        expect(existsSync(home)).toBe(true)
        const homeIdx = sandbox.args.indexOf("HOME")
        expect(sandbox.args[homeIdx - 1]).toBe("--setenv")
        expect(sandbox.args[homeIdx + 1]).toBe(home)
        const userIdx = sandbox.args.indexOf("USER")
        expect(sandbox.args[userIdx - 1]).toBe("--setenv")
        expect(sandbox.args[userIdx + 1]).toBe("terminal_home")
        expect(sandbox.args).toContain("LOGNAME")
        expect(TerminalSandbox.sandboxUserName(session)).toBe("terminal_home")
        const workspaceIdx = sandbox.args.indexOf("ONECODE_WORKSPACE_ROOT")
        expect(sandbox.args[workspaceIdx - 1]).toBe("--setenv")
        expect(sandbox.args[workspaceIdx + 1]).toBe(root.replaceAll("\\", "/"))
      },
    )

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "docker",
        ONECODE_DOCKER_PATH: process.execPath,
        ONECODE_DOCKER_PROBE: "0",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-home-docker@example.com",
          name: "terminal_home_docker",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-lc", "pwd"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expect(TerminalSandbox.sandboxHomePath(root)).toBe(path.resolve(root).replaceAll("\\", "/"))
        expect(sandbox.args).toContain("HOME=/workspace")
        expect(sandbox.args).toContain("ONECODE_WORKSPACE_ROOT=/workspace")
      },
    )
  })

  test("sandbox mounts shared oneskills read-only from ONECODE_EXTRA_PATH", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    const extra = path.join(os.tmpdir(), `onecode-oneskills-ro-${Date.now()}-${process.pid}`)
    const oneskills = path.join(extra, ".opencode", "oneskills")
    mkdirSync(oneskills, { recursive: true })
    const oneskillsPosix = path.resolve(oneskills).replaceAll("\\", "/")

    try {
      withEnv(
        {
          ONECODE_EXTRA_PATH: undefined,
          OPENCODE_TEST_HOME: undefined,
        },
        () => {
          const fallback = path.join(os.homedir(), ".opencode", "oneskills").replaceAll("\\", "/")
          expect(TerminalSandbox.sharedOneskillsPath()).toBe(fallback)
        },
      )

      withEnv(
        {
          ONECODE_EXTRA_PATH: extra,
          ONECODE_TERMINAL_ISOLATION: "bubblewrap",
          ONECODE_BWRAP_PATH: "bwrap",
          ONECODE_BWRAP_PROBE: "0",
        },
        () => {
          expect(TerminalSandbox.sharedOneskillsPath()).toBe(oneskillsPosix)
          const session = PlatformAuth.register({
            email: "terminal-oneskills@example.com",
            name: "terminal_oneskills",
            password: "password123",
          })
          const root = session.workspaces[0]!.defaultEnvPath
          const sandbox = TerminalSandbox.prepare({
            session,
            command: "/bin/bash",
            args: ["-lc", "pwd"],
            cwd: root,
            env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
          })
          const idx = sandbox.args.indexOf(oneskillsPosix)
          expect(idx).toBeGreaterThan(0)
          expect(sandbox.args[idx - 1]).toBe("--ro-bind-try")
          expect(sandbox.args[idx + 1]).toBe(oneskillsPosix)
        },
      )

      withEnv(
        {
          ONECODE_EXTRA_PATH: extra,
          ONECODE_TERMINAL_ISOLATION: "docker",
          ONECODE_DOCKER_PATH: process.execPath,
          ONECODE_DOCKER_PROBE: "0",
        },
        () => {
          const session = PlatformAuth.register({
            email: "terminal-oneskills-docker@example.com",
            name: "terminal_oneskills_docker",
            password: "password123",
          })
          const root = session.workspaces[0]!.defaultEnvPath
          const sandbox = TerminalSandbox.prepare({
            session,
            command: "/bin/bash",
            args: ["-lc", "pwd"],
            cwd: root,
            env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
          })
          expect(sandbox.args).toContain(`${oneskillsPosix}:${oneskillsPosix}:ro`)
        },
      )
    } finally {
      rmSync(extra, { recursive: true, force: true })
    }
  })

  test("sandbox mounts account platform-ssh at absolute path and $HOME/.ssh", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-ssh@example.com",
          name: "terminal_ssh",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sshHome = TerminalSandbox.platformSshHomeForSession(session)
        const home = TerminalSandbox.sandboxHomePath(root)
        const homeSsh = `${home}/.ssh`
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-lc", "ls ~/.ssh"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expect(existsSync(sshHome)).toBe(true)
        expect(existsSync(path.join(sshHome, "identities"))).toBe(true)

        const absIdx = sandbox.args.indexOf(sshHome)
        expect(absIdx).toBeGreaterThan(0)
        expect(sandbox.args[absIdx - 1]).toBe("--ro-bind-try")
        expect(sandbox.args[absIdx + 1]).toBe(sshHome)

        const homeSshIdx = sandbox.args.lastIndexOf(homeSsh)
        expect(homeSshIdx).toBeGreaterThan(0)
        expect(sandbox.args[homeSshIdx - 2]).toBe("--ro-bind-try")
        expect(sandbox.args[homeSshIdx - 1]).toBe(sshHome)

        const envIdx = sandbox.args.indexOf("ONECODE_PLATFORM_SSH_HOME")
        expect(sandbox.args[envIdx - 1]).toBe("--setenv")
        expect(sandbox.args[envIdx + 1]).toBe(sshHome)
      },
    )

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "bubblewrap",
        ONECODE_BWRAP_PATH: "bwrap",
        ONECODE_BWRAP_PROBE: "0",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-ssh-native-then-bwrap@example.com",
          name: "terminal_ssh_nb",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sshHome = TerminalSandbox.platformSshHomeForSession(session)
        const home = TerminalSandbox.sandboxHomePath(root)
        const homeSsh = path.join(home, ".ssh")

        // Simulate native mode leaving a symlink that bubblewrap cannot bind onto.
        mkdirSync(home, { recursive: true })
        mkdirSync(sshHome, { recursive: true })
        try {
          symlinkSync(sshHome, homeSsh)
        } catch {
          // Windows may need junction; skip if symlink unsupported in CI.
          if (process.platform === "win32") {
            symlinkSync(sshHome, homeSsh, "junction")
          } else {
            throw new Error("failed to create native-style ~/.ssh symlink for test")
          }
        }
        expect(lstatSync(homeSsh).isSymbolicLink() || process.platform === "win32").toBe(true)

        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-lc", "ls ~/.ssh"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })

        const st = lstatSync(homeSsh)
        expect(st.isSymbolicLink()).toBe(false)
        expect(st.isDirectory()).toBe(true)
        expect(sandbox.args).toContain("--dir")
        expect(sandbox.args.lastIndexOf(homeSsh.replace(/\\/g, "/"))).toBeGreaterThan(0)
      },
    )

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "docker",
        ONECODE_DOCKER_PATH: process.execPath,
        ONECODE_DOCKER_PROBE: "0",
      },
      () => {
        const session = PlatformAuth.register({
          email: "terminal-ssh-docker@example.com",
          name: "terminal_ssh_docker",
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        const sshHome = TerminalSandbox.platformSshHomeForSession(session)
        const sandbox = TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-lc", "ls ~/.ssh"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expect(sandbox.args).toContain(`${sshHome}:${sshHome}:ro`)
        expect(sandbox.args).toContain(`${sshHome}:/workspace/.ssh:ro`)
        expect(sandbox.args).toContain(`ONECODE_PLATFORM_SSH_HOME=${sshHome}`)
      },
    )
  })

  test("native mode remaps HOME and links ~/.ssh to account platform-ssh", async () => {
    await resetDatabase()
    resetPlatformAuthTables()

    withEnv(
      {
        ONECODE_TERMINAL_ISOLATION: "native",
      },
      () => {
        const sessionA = PlatformAuth.register({
          email: "native-ssh-a@example.com",
          name: "native_ssh_a",
          password: "password123",
        })
        const sessionB = PlatformAuth.register({
          email: "native-ssh-b@example.com",
          name: "native_ssh_b",
          password: "password123",
        })
        const rootA = sessionA.workspaces[0]!.defaultEnvPath
        const rootB = sessionB.workspaces[0]!.defaultEnvPath
        const sshA = TerminalSandbox.platformSshHomeForSession(sessionA)
        const sshB = TerminalSandbox.platformSshHomeForSession(sessionB)
        expect(sshA).not.toBe(sshB)

        const preparedA = TerminalSandbox.prepare({
          session: sessionA,
          command: "/bin/bash",
          args: ["-lc", "cat ~/.ssh/config"],
          cwd: rootA,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm", HOME: "/tmp/wrong-home" },
        })
        const preparedB = TerminalSandbox.prepare({
          session: sessionB,
          command: "/bin/bash",
          args: ["-lc", "cat ~/.ssh/config"],
          cwd: rootB,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm", HOME: "/tmp/wrong-home" },
        })

        const homeA = TerminalSandbox.sandboxHomePath(rootA)
        const homeB = TerminalSandbox.sandboxHomePath(rootB)
        expect(preparedA.env.HOME).toBe(homeA)
        expect(preparedB.env.HOME).toBe(homeB)
        expect(preparedA.env.ONECODE_PLATFORM_SSH_HOME).toBe(sshA)
        expect(preparedB.env.ONECODE_PLATFORM_SSH_HOME).toBe(sshB)
        expect(preparedA.sandboxed).toBe(false)

        const linkA = path.join(homeA, ".ssh")
        const linkB = path.join(homeB, ".ssh")
        expect(existsSync(linkA)).toBe(true)
        expect(existsSync(linkB)).toBe(true)
        expect(path.resolve(realpathSync(linkA))).toBe(path.resolve(sshA))
        expect(path.resolve(realpathSync(linkB))).toBe(path.resolve(sshB))
      },
    )
  })

  function expectSandboxAliases(home: string) {
    const aliases = readFileSync(TerminalSandbox.sandboxShellAliasesPath(home), "utf8")
    expect(aliases).toContain("alias ll='ls -alF'")
    expect(aliases).toContain("alias grep='grep --color=auto'")
    expect(aliases).toContain("alias ls='ls --color=auto'")
    expect(aliases).toContain("alias mv='mv -i'")
    expect(aliases).toContain("alias rm='rm -i'")
    const bashrc = readFileSync(path.join(home, ".bashrc"), "utf8")
    expect(bashrc).toContain(".onecode/shell-aliases.sh")
    const profile = readFileSync(path.join(home, ".bash_profile"), "utf8")
    expect(profile).toContain(".bashrc")
  }

  test("seeds default shell aliases into sandbox HOME for bash -l", () => {
    const home = path.join(os.tmpdir(), `onecode-shell-aliases-${Date.now()}-${process.pid}`)
    mkdirSync(home, { recursive: true })
    try {
      TerminalSandbox.ensureSandboxShellAliases(home)
      expectSandboxAliases(home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("platform terminals seed default shell aliases for native, bubblewrap, and docker", async () => {
    if (process.platform === "win32") return
    await resetDatabase()
    resetPlatformAuthTables()

    const modes = [
      { ONECODE_TERMINAL_ISOLATION: "native" },
      { ONECODE_TERMINAL_ISOLATION: "bubblewrap", ONECODE_BWRAP_PATH: "bwrap", ONECODE_BWRAP_PROBE: "0" },
      { ONECODE_TERMINAL_ISOLATION: "docker", ONECODE_DOCKER_PATH: process.execPath, ONECODE_DOCKER_PROBE: "0" },
    ] as const

    for (const env of modes) {
      withEnv({ ...env }, () => {
        const session = PlatformAuth.register({
          email: `terminal-aliases-${env.ONECODE_TERMINAL_ISOLATION}@example.com`,
          name: `terminal_aliases_${env.ONECODE_TERMINAL_ISOLATION}`,
          password: "password123",
        })
        const root = session.workspaces[0]!.defaultEnvPath
        TerminalSandbox.prepare({
          session,
          command: "/bin/bash",
          args: ["-l"],
          cwd: root,
          env: { PATH: "/usr/bin:/bin", TERM: "xterm" },
        })
        expectSandboxAliases(TerminalSandbox.sandboxHomePath(root))
      })
    }
  })

  test("sandbox shell alias hook preserves existing bashrc and stays idempotent", () => {
    const home = path.join(os.tmpdir(), `onecode-shell-aliases-preserve-${Date.now()}-${process.pid}`)
    mkdirSync(home, { recursive: true })
    writeFileSync(path.join(home, ".bashrc"), "alias ll='user-ll'\n", { encoding: "utf8" })
    writeFileSync(path.join(home, ".profile"), "# existing profile\n", { encoding: "utf8" })
    try {
      TerminalSandbox.ensureSandboxShellAliases(home)
      TerminalSandbox.ensureSandboxShellAliases(home)

      const bashrc = readFileSync(path.join(home, ".bashrc"), "utf8")
      expect(bashrc.startsWith("# >>> onecode shell aliases >>>")).toBe(true)
      expect(bashrc).toContain("alias ll='user-ll'")
      expect(bashrc.split("# >>> onecode shell aliases >>>").length).toBe(2)
      expect(existsSync(path.join(home, ".bash_profile"))).toBe(false)
      const profile = readFileSync(path.join(home, ".profile"), "utf8")
      expect(profile).toContain(".onecode/shell-aliases.sh")
      expect(profile).toContain("# existing profile")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("workspaceEnvRoot does not nest when HOME is already under workspaces", async () => {
    const previousHome = process.env.HOME
    const previousExtra = process.env.ONECODE_EXTRA_PATH
    delete process.env.ONECODE_EXTRA_PATH
    try {
      process.env.HOME = "/data/hanmk/privated_data/workspaces/sugon/.home"
      expect(PlatformAuth.workspaceEnvRoot()).toBe("/data/hanmk/privated_data/workspaces")

      process.env.HOME = "/data/hanmk/privated_data/workspaces/sugon"
      expect(PlatformAuth.workspaceEnvRoot()).toBe("/data/hanmk/privated_data/workspaces")

      process.env.HOME = "/data/hanmk/privated_data"
      expect(PlatformAuth.workspaceEnvRoot()).toBe("/data/hanmk/privated_data/workspaces")

      process.env.HOME = "/home/hanmk"
      expect(PlatformAuth.workspaceEnvRoot()).toBe("/home/hanmk/privated_data/workspaces")
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
      else process.env.ONECODE_EXTRA_PATH = previousExtra
    }
  })
})
