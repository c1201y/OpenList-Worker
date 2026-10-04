import CryptoJS from "crypto-js"
import {
  Yun139Addition,
  QueryRoutePolicyResp,
  Yun139DiskResp,
  Yun139DownloadResp,
  Yun139FileItem,
  Yun139StorageDetailsResp,
  PersonalListResp,
  PersonalDownloadResp,
  PersonalFileItem,
  PartInfo,
  PersonalPartInfo,
  PersonalUploadResp,
  PersonalUploadUrlResp,
} from "./types"

export function encodeURIComponentCustom(str: string): string {
  let r = encodeURIComponent(str)
  r = r.replace(/\+/g, "%20")
  r = r.replace(/!/g, "%21")
  r = r.replace(/'/g, "%27")
  r = r.replace(/\(/g, "%28")
  r = r.replace(/\)/g, "%29")
  r = r.replace(/\*/g, "%2A")
  return r
}

export function md5(str: string): string {
  return CryptoJS.MD5(str).toString(CryptoJS.enc.Hex)
}

export function calSign(body: string, ts: string, randStr: string): string {
  const enc = encodeURIComponentCustom(body)
  const sorted = enc.split("").sort().join("")
  const words = CryptoJS.enc.Utf8.parse(sorted)
  const b64 = CryptoJS.enc.Base64.stringify(words)
  const res = md5(b64) + md5(`${ts}:${randStr}`)
  return md5(res).toUpperCase()
}

export function randomString(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let res = ""
  for (let i = 0; i < len; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return res
}

export function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export class Yun139ApiClient {
  private addition: Yun139Addition
  public personalHost = "https://yun.139.com"
  public familyHost = "https://yun.139.com"
  public groupHost = "https://yun.139.com"
  public account = ""

  constructor(addition: Yun139Addition) {
    this.addition = addition
    this.extractAccount()
  }

  private extractAccount(): void {
    if (!this.addition.authorization) return
    try {
      const authStr = this.getAuthString()
      const decoded = CryptoJS.enc.Base64.parse(authStr).toString(
        CryptoJS.enc.Utf8,
      )
      const splits = decoded.split(":")
      if (splits.length >= 2) {
        this.account = splits[1]
      }
    } catch {
      // Ignored
    }
  }

  public getAuthString(): string {
    let auth = (this.addition.authorization || "").trim()
    if (auth.startsWith("Basic ")) {
      auth = auth.slice(6).trim()
    }
    return auth
  }

  isPersonalNew(): boolean {
    return !this.addition.type || this.addition.type === "personal_new"
  }

  isFamily(): boolean {
    return this.addition.type === "family"
  }

  isGroup(): boolean {
    return this.addition.type === "group"
  }

  getHost(): string {
    if (this.isFamily()) return this.familyHost
    if (this.isGroup()) return this.groupHost
    return this.personalHost
  }

  async request<T = any>(uriOrUrl: string, body: any): Promise<T> {
    const ts = formatTime(new Date())
    const randStr = randomString(16)
    const bodyStr = JSON.stringify(body || {})
    const sign = calSign(bodyStr, ts, randStr)

    let url: string
    if (uriOrUrl.startsWith("http://") || uriOrUrl.startsWith("https://")) {
      url = uriOrUrl
    } else if (uriOrUrl.startsWith("/orchestration/")) {
      // Orchestration APIs are strictly hosted on yun.139.com
      url = `https://yun.139.com${uriOrUrl}`
    } else {
      url = `${this.getHost()}${uriOrUrl}`
    }

    const svcType = this.isFamily() ? "2" : "1"
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "CMS-DEVICE": "default",
      Authorization: `Basic ${this.getAuthString()}`,
      Caller: "web",
      "Mcloud-Channel": "1000101",
      "Mcloud-Client": "10701",
      "Mcloud-Route": "001",
      "mcloud-channel": "1000101",
      "mcloud-client": "10701",
      "mcloud-sign": `${ts},${randStr},${sign}`,
      "mcloud-version": "7.14.0",
      Origin: "https://yun.139.com",
      Referer: "https://yun.139.com/w/",
      "x-DeviceInfo": "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||",
      "x-huawei-channelSrc": "10000034",
      "x-inner-ntwk": "2",
      "x-m4c-caller": "PC",
      "x-m4c-src": "10002",
      "x-SvcType": svcType,
      "Inner-Hcy-Router-Https": "1",
      "X-Yun-Api-Version": "v1",
      "X-Yun-App-Channel": "10000034",
      "X-Yun-Channel-Source": "10000034",
      "X-Yun-Client-Info":
        "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||dW5kZWZpbmVk||",
      "X-Yun-Module-Type": "100",
      "X-Yun-Svc-Type": "1",
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`139 Cloud API error (${res.status}): ${text}`)
    }

    const json = (await res.json()) as any
    if (json.success === false && json.message) {
      throw new Error(`139 Cloud API error: ${json.message}`)
    }
    return json as T
  }

  async init(): Promise<void> {
    if (!this.addition.authorization) {
      throw new Error("139 Cloud Authorization is required")
    }

    try {
      const routeRes = await this.request<QueryRoutePolicyResp>(
        "https://user-njs.yun.139.com/user/route/qryRoutePolicy",
        {
          userInfo: {
            userType: 1,
            accountType: 1,
            accountName: this.account,
          },
          modAddrType: 1,
        },
      )

      if (routeRes.data?.routePolicyList) {
        for (const policy of routeRes.data.routePolicyList) {
          if (policy.modName === "personal" && policy.httpsUrl) {
            this.personalHost = policy.httpsUrl
          } else if (policy.modName === "group" && policy.httpsUrl) {
            this.groupHost = policy.httpsUrl
          } else if (policy.modName === "family" && policy.httpsUrl) {
            this.familyHost = policy.httpsUrl
          }
        }
      }
    } catch (e) {
      console.warn(
        "[139] queryRoutePolicy warning, fallback to default host:",
        e,
      )
    }
  }

  async listFiles(folderId = ""): Promise<{
    files: Yun139FileItem[]
    folders: Array<{
      catalogID: string
      catalogName: string
      updateTime?: string
    }>
  }> {
    if (this.isPersonalNew()) {
      let nextPageCursor = ""
      const allItems: PersonalFileItem[] = []
      const parentFileId = folderId || this.addition.root_folder_id || "/"

      do {
        const res = await this.request<PersonalListResp>("/file/list", {
          parentFileId,
          pageInfo: {
            pageCursor: nextPageCursor,
            pageSize: 100,
          },
          orderBy: "updated_at",
          orderDirection: "DESC",
          imageThumbnailStyleList: ["Small", "Large"],
        })

        const items = res.data?.items || []
        allItems.push(...items)
        nextPageCursor = res.data?.nextPageCursor || ""
      } while (nextPageCursor)

      const folders = allItems
        .filter((i) => i.type === "folder")
        .map((i) => ({
          catalogID: i.fileId,
          catalogName: i.name,
          updateTime: i.updatedAt,
        }))

      const files: Yun139FileItem[] = allItems
        .filter((i) => i.type !== "folder")
        .map((i) => ({
          contentID: i.fileId,
          contentName: i.name,
          contentSize: i.size,
          updateTime: i.updatedAt,
          createTime: i.createdAt,
          thumbnailURL: i.thumbnailUrls?.[0]?.url,
        }))

      return { files, folders }
    }

    return this.getDisk(folderId)
  }

  async getDisk(catalogId = ""): Promise<{
    files: Yun139FileItem[]
    folders: Array<{
      catalogID: string
      catalogName: string
      updateTime?: string
    }>
  }> {
    const res = await this.request<Yun139DiskResp>(
      "/orchestration/personalCloud/catalog/v1.0/getDisk",
      {
        catalogID: catalogId || "",
        sortDirection: 1,
        filterType: 0,
        catalogSortType: 0,
        contentSortType: 0,
        startNumber: 1,
        endNumber: 5000,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )

    const diskResult = res.data?.getDiskResult
    return {
      files: diskResult?.fileList || [],
      folders: diskResult?.catalogList || [],
    }
  }

  async getDownloadUrl(contentIdOrFileId: string): Promise<string> {
    if (this.isPersonalNew()) {
      const res = await this.request<PersonalDownloadResp>(
        "/file/getDownloadUrl",
        {
          fileId: contentIdOrFileId,
        },
      )
      const url =
        (res.data?.cdnSwitch ? res.data?.cdnUrl : null) ||
        res.data?.url ||
        res.data?.cdnUrl
      if (!url) {
        throw new Error("Empty download URL received from 139 Cloud")
      }
      return url
    }

    const res = await this.request<Yun139DownloadResp>(
      "/orchestration/personalCloud/uploadAndDownload/v1.0/downloadRequest",
      {
        contentID: contentIdOrFileId,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )

    const url = res.data?.downloadURL || res.data?.url
    if (!url) {
      throw new Error("Empty download URL received from 139 Cloud")
    }
    return url
  }

  async createCatalog(parentCatalogId: string, name: string): Promise<string> {
    if (this.isPersonalNew()) {
      const res = await this.request<any>("/file/create", {
        parentFileId: parentCatalogId || this.addition.root_folder_id || "/",
        name,
        description: "",
        type: "folder",
        fileRenameMode: "force_rename",
      })
      return res.data?.fileId || ""
    }

    const res = await this.request<any>(
      "/orchestration/personalCloud/catalog/v1.0/createCatalog",
      {
        parentCatalogID: parentCatalogId || "",
        catalogName: name,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
    return res.data?.catalogID || ""
  }

  async deleteFile(contentIdOrFileId: string): Promise<void> {
    if (this.isPersonalNew()) {
      // 个人云新版删除走回收站接口（/file/delete 会返回认证失败）
      await this.request("/recyclebin/batchTrash", {
        fileIds: [contentIdOrFileId],
      })
      return
    }

    await this.request(
      "/orchestration/personalCloud/catalog/v1.0/deleteContent",
      {
        contentID: contentIdOrFileId,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
  }

  async deleteCatalog(catalogIdOrFileId: string): Promise<void> {
    if (this.isPersonalNew()) {
      // 个人云新版删除走回收站接口（/file/delete 会返回认证失败）
      await this.request("/recyclebin/batchTrash", {
        fileIds: [catalogIdOrFileId],
      })
      return
    }

    await this.request(
      "/orchestration/personalCloud/catalog/v1.0/deleteCatalog",
      {
        catalogID: catalogIdOrFileId,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
  }

  async rename(id: string, newName: string): Promise<void> {
    if (this.isPersonalNew()) {
      await this.request("/file/update", {
        fileId: id,
        name: newName,
        description: "",
      })
      return
    }

    await this.request(
      "/orchestration/personalCloud/catalog/v1.0/updateCatalogInfo",
      {
        catalogID: id,
        catalogName: newName,
        commonAccountInfo: {
          account: this.account,
          accountType: 1,
        },
      },
    )
  }

  /**
   * 分片大小（字节）。用户可经 custom_upload_part_size 覆盖；默认 100MB，
   * 文件超过 30GB 时用 512MB 以规避网盘的分片数量上限。
   */
  private getUploadPartSize(size: number): number {
    if (this.addition.custom_upload_part_size) {
      return this.addition.custom_upload_part_size
    }
    if (size > 30 * 1024 * 1024 * 1024) {
      return 512 * 1024 * 1024
    }
    return 100 * 1024 * 1024
  }

  /** 计算整文件的 SHA-256（十六进制小写），作为秒传与完整性校验依据 */
  async sha256Hex(content: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      content as unknown as BufferSource,
    )
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  /**
   * 按服务端返回的地址逐片 PUT 到 EOS。uploadPartInfos 只覆盖部分分片
   * （创建时最多 100 片、其余走 getUploadUrl），故用 partNumber 反查偏移。
   */
  async uploadPersonalParts(
    partInfos: PartInfo[],
    uploadPartInfos: PersonalPartInfo[],
    content: Buffer | Uint8Array,
  ): Promise<void> {
    const sorted = [...uploadPartInfos].sort(
      (a, b) => a.partNumber - b.partNumber,
    )
    for (const uploadPartInfo of sorted) {
      const index = uploadPartInfo.partNumber - 1
      if (index < 0 || index >= partInfos.length) {
        throw new Error(
          `invalid partNumber ${uploadPartInfo.partNumber}: out of bounds (partInfos length: ${partInfos.length})`,
        )
      }
      const { partOffset } = partInfos[index].parallelHashCtx
      const partSize = partInfos[index].partSize
      const bytes = content.subarray(partOffset, partOffset + partSize)

      const res = await fetch(uploadPartInfo.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          Origin: "https://yun.139.com",
          Referer: "https://yun.139.com/",
        },
        body: bytes as unknown as BodyInit,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(
          `139 part upload failed (${res.status}): ${String(text).slice(0, 200)}`,
        )
      }
    }
  }

  /**
   * 个人云新版上传：/file/create 建任务并取前 100 片地址 → 逐片 PUT →
   * /file/complete 收尾。返回云端实际文件名（命中 auto_rename 时会与入参不同）。
   */
  async uploadPersonalFile(
    parentFileId: string,
    name: string,
    content: Buffer | Uint8Array,
  ): Promise<{ fileName: string }> {
    const size = content.length
    const partSize = this.getUploadPartSize(size)
    const partCount = size > partSize ? Math.ceil(size / partSize) : 1

    const partInfos: PartInfo[] = []
    for (let i = 0; i < partCount; i++) {
      const start = i * partSize
      const byteSize = Math.min(size - start, partSize)
      partInfos.push({
        partNumber: i + 1,
        partSize: byteSize,
        parallelHashCtx: { partOffset: start },
      })
    }

    const fullHash = await this.sha256Hex(content)

    const createResp = await this.request<PersonalUploadResp>("/file/create", {
      contentHash: fullHash,
      contentHashAlgorithm: "SHA256",
      contentType: "application/octet-stream",
      parallelUpload: false,
      partInfos: partInfos.slice(0, 100),
      size,
      parentFileId: parentFileId || this.addition.root_folder_id || "/",
      name,
      type: "file",
      fileRenameMode: "auto_rename",
    })

    // exist=true：云端已有同名同内容文件（秒传命中），无需实际上传
    if (createResp.data?.exist) {
      return { fileName: createResp.data?.fileName || name }
    }

    const fileId = createResp.data?.fileId || ""
    const uploadId = createResp.data?.uploadId || ""
    const initialParts = createResp.data?.partInfos

    if (initialParts && initialParts.length > 0) {
      await this.uploadPersonalParts(partInfos, initialParts, content)

      // 超过 100 片：分批向 /file/getUploadUrl 索取剩余分片地址
      for (let i = 100; i < partInfos.length; i += 100) {
        const batch = partInfos.slice(i, i + 100)
        const moreResp = await this.request<PersonalUploadUrlResp>(
          "/file/getUploadUrl",
          {
            fileId,
            uploadId,
            partInfos: batch,
            commonAccountInfo: {
              account: this.account,
              accountType: 1,
            },
          },
        )
        await this.uploadPersonalParts(
          partInfos,
          moreResp.data?.partInfos || [],
          content,
        )
      }

      await this.request("/file/complete", {
        contentHash: fullHash,
        contentHashAlgorithm: "SHA256",
        fileId,
        uploadId,
      })
    }

    return { fileName: createResp.data?.fileName || name }
  }

  async getStorageDetails(): Promise<{ total?: number; used?: number }> {
    try {
      const res = await this.request<Yun139StorageDetailsResp>(
        "/orchestration/personalCloud/catalog/v1.0/getUserDomainInfo",
        {
          commonAccountInfo: {
            account: this.account,
            accountType: 1,
          },
        },
      )
      return {
        total: res.data?.totalSize,
        used: res.data?.usedSize,
      }
    } catch {
      return {}
    }
  }
}
