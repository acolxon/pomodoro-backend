import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Task, TaskStatus } from './entities/task.entity';
import { isActiveTaskCollision, taskErrors } from './tasks.errors';

@Injectable()
export class TasksService {
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
      return await this.tasks.manager.transaction(async (manager) => {
        const task = await manager.findOne(Task, {
          where: { id: taskId, userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!task) throw taskErrors.notFound();
        if (dto.title !== undefined) task.title = dto.title;
        if (dto.description !== undefined) task.description = dto.description;
        if (dto.status !== undefined && dto.status !== task.status) {
          task.status = dto.status;
          task.completedAt = dto.status === TaskStatus.Completed ? new Date() : null;
        }
        return manager.save(task);
      });
    } catch (error) {
      if (isActiveTaskCollision(error)) throw taskErrors.activeTaskExists();
      throw error;
    }
  }

  async remove(userId: string, taskId: string): Promise<void> {
    const result = await this.tasks.delete({ id: taskId, userId });
    if (!result.affected) throw taskErrors.notFound();
  }
}
