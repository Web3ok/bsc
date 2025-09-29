import { Router } from 'express';

export class StrategyManagementAPI {
  public router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.router.get('/list', (req, res) => {
      res.json({
        success: true,
        data: {
          strategies: [],
          total: 0,
        },
      });
    });

    this.router.post('/create', (req, res) => {
      res.json({
        success: true,
        data: {
          strategy: {
            id: 'strategy_1',
            name: req.body.name || 'New Strategy',
            type: req.body.type || 'grid',
            status: 'created',
          },
        },
      });
    });

    this.router.get('/:id', (req, res) => {
      res.json({
        success: true,
        data: {
          strategy: {
            id: req.params.id,
            name: 'Strategy',
            type: 'grid',
            status: 'running',
          },
        },
      });
    });
  }
}