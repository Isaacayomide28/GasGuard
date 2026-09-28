import { Router } from 'express';
import { findingsController } from './findings.controller';

export const findingsRouter = Router();

findingsRouter.get('/', (req, res) => findingsController.list(req, res));
findingsRouter.get('/:id', (req, res) => findingsController.getOne(req, res));
