import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Task, TaskStatus } from './entities/task.entity';
import { isActiveTaskCollision, taskErrors } from './tasks.errors';
import { RoomMember } from '../rooms/entities/room-member.entity';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readinessListener?: (roomId: string) => void;
  setReadinessListener(listener: (roomId: string) => void): void {
    this.readinessListener = listener;
  }
  private notifyReadiness(roomId: string | null): void {
    if (!roomId) return;
    try {
      this.readinessListener?.(roomId);
    } catch (error) {
      this.logger.error('Failed to publish readiness change', error);
    }
  }
  constructor(@InjectRepository(Task) private readonly tasks: Repository<Task>) {}

  async create(userId: string, dto: CreateTaskDto): Promise<Task> {
    const task = this.tasks.create({
      userId,
      title: dto.title,
      description: dto.description?.trim() || null,
      status: TaskStatus.Todo,
      completedAt: null,
    });
    return this.tasks.save(task);
  }

  findAll(userId: string, status?: TaskStatus): Promise<Task[]> {
    return this.tasks.find({
      where: status ? { userId, status } : { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async findOne(userId: string, taskId: string): Promise<Task> {
    const task = await this.tasks.findOneBy({ id: taskId, userId });
    if (!task) throw taskErrors.notFound();
    return task;
  }

  async update(userId: string, taskId: string, dto: UpdateTaskDto): Promise<Task> {
    try {
      let roomId: string | null = null;
      const saved = await this.tasks.manager.transaction(async (manager) => {
        const task = await manager.findOne(Task, {
          where: { id: taskId, userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!task) throw taskErrors.notFound();
        if (dto.title !== undefined) task.title = dto.title;
        if (dto.description !== undefined) task.description = dto.description;
        if (dto.status !== undefined && dto.status !== task.status) {
          const wasActive = task.status === TaskStatus.InProgress;
          task.status = dto.status;
          task.completedAt = dto.status === TaskStatus.Completed ? new Date() : null;
          if (wasActive && dto.status !== TaskStatus.InProgress) {
            const changed = await manager
              .createQueryBuilder()
              .update(RoomMember)
              .set({ ready: false })
              .where('user_id = :userId AND left_at IS NULL AND ready = true', { userId })
              .returning('room_id')
              .execute();
            roomId = changed.raw[0]?.room_id ?? null;
          }
        }
        return manager.save(task);
      });
      this.notifyReadiness(roomId);
      return saved;
    } catch (error) {
      if (isActiveTaskCollision(error)) throw taskErrors.activeTaskExists();
      throw error;
    }
  }

  async remove(userId: string, taskId: string): Promise<void> {
    let roomId: string | null = null;
    await this.tasks.manager.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { id: taskId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw taskErrors.notFound();
      if (task.status === TaskStatus.InProgress) {
        const changed = await manager
          .createQueryBuilder()
          .update(RoomMember)
          .set({ ready: false })
          .where('user_id = :userId AND left_at IS NULL AND ready = true', { userId })
          .returning('room_id')
          .execute();
        roomId = changed.raw[0]?.room_id ?? null;
      }
      await manager.delete(Task, { id: taskId, userId });
    });
    this.notifyReadiness(roomId);
  }
}
