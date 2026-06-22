import { IDatabaseService, IKernel } from "../types";
import { ChatSession } from "../../types";
import { getAllSessions, saveSession, deleteSession } from "../../utils/localDB";

export class DatabaseService implements IDatabaseService {
  name = "database";
  isCritical = true;
  private kernel!: IKernel;

  init(kernel: IKernel): void {
    this.kernel = kernel;
  }

  async getAllSessions(): Promise<ChatSession[]> {
    return getAllSessions();
  }

  async saveSession(session: ChatSession): Promise<void> {
    return saveSession(session);
  }

  async deleteSession(id: string): Promise<void> {
    return deleteSession(id);
  }
}
