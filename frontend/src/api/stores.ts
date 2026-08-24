import type { Store } from "../types/api"
import { apiRequest } from "./client"

export function getStores(): Promise<Store[]> {
  return apiRequest<Store[]>("stores/")
}

export function getStore(storeId: string): Promise<Store> {
  return apiRequest<Store>(`stores/${encodeURIComponent(storeId)}/`)
}
