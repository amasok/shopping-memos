import type {
  Tag,
  CreateTagInput,
  UpdateTagInput,
  GetTagsQuery,
  TagWithUsageCount,
} from "../entities/Tag"

/**
 * タグリポジトリインターフェース
 */
export interface TagRepository {
  /**
   * タグを作成
   */
  create(input: CreateTagInput): Promise<Tag>

  /**
   * タグをIDで取得
   */
  findById(id: string): Promise<Tag | null>

  /**
   * タグ一覧を取得（フィルタリング可能）
   */
  findMany(query: GetTagsQuery): Promise<TagWithUsageCount[]>

  /**
   * タグを更新
   */
  update(input: UpdateTagInput): Promise<Tag>

  /**
   * タグを削除
   */
  delete(id: string): Promise<void>

  /**
   * ユーザーがタグにアクセスできるか確認
   * グループメンバーであればアクセス可能
   */
  canAccess(tagId: string, userId: string): Promise<boolean>
}
