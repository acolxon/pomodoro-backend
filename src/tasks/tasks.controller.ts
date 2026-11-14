import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { uuidPipe } from '../common/pipes/uuid.pipe';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskQueryDto } from './dto/task-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Task } from './entities/task.entity';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'UNAUTHORIZED — нет или недействителен JWT' })
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Создать личную задачу' })
  @ApiCreatedResponse({ type: Task })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto): Promise<Task> {
    return this.tasks.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Список личных задач' })
  @ApiOkResponse({ type: [Task] })
  findAll(@CurrentUser() user: AuthUser, @Query() query: TaskQueryDto): Promise<Task[]> {
    return this.tasks.findAll(user.id, query.status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить задачу' })
  @ApiOkResponse({ type: Task })
  @ApiNotFoundResponse({ description: 'TASK_NOT_FOUND' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string): Promise<Task> {
    return this.tasks.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить задачу или её статус' })
  @ApiOkResponse({ type: Task })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR' })
  @ApiNotFoundResponse({ description: 'TASK_NOT_FOUND' })
  @ApiConflictResponse({ description: 'ACTIVE_TASK_EXISTS' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasks.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить задачу' })
  @ApiNotFoundResponse({ description: 'TASK_NOT_FOUND' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string): Promise<void> {
    await this.tasks.remove(user.id, id);
  }
}
