import { Router, type Request, type Response } from 'express';

import ConversationalAIController from '../controllers/ConversationController';
import { prisma } from '../lib/prisma';
import protect from '../middleware/authMiddleware';

const router = Router();

/** The document kinds the conversational assistant can read back or delete. */
type DocumentType = 'invoice' | 'quotation' | 'expense';

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Tenant (company-owner) id so the AI assistant operates over the shared
 * workspace dataset — every admin can view/edit/delete its documents.
 * Falls back to the acting user only if tenant resolution was skipped.
 *
 * `protect` always sets one of the two, so the null return is defensive. It is
 * checked rather than passed through because ConversationalAIController scopes
 * every query by this id: an undefined workspace would widen those queries
 * instead of narrowing them.
 */
const workspaceIdOf = (req: Request): string | null => req.tenantId || req.user || null;

const noWorkspace = (res: Response): void => {
  res.status(401).json({ success: false, message: 'Could not resolve the workspace.' });
};

router.post('/message', protect, async (req: Request, res: Response) => {
  try {
    const { message: userMessage, sessionId } = req.body as {
      message?: string;
      sessionId?: string;
    };
    const tenantId = workspaceIdOf(req);
    if (!tenantId) return noWorkspace(res);

    if (!userMessage) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    console.log(
      `Processing conversation message for user ${tenantId}:`,
      userMessage.substring(0, 50) + '...',
    );

    const aiService = new ConversationalAIController(tenantId, sessionId);
    const response = await aiService.processMessage(userMessage);

    res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error('Conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing message',
      error: message(error),
    });
  }
});

router.get('/history/:sessionId', protect, async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId ?? '');
    const tenantId = workspaceIdOf(req);
    if (!tenantId) return noWorkspace(res);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required',
      });
    }

    const aiService = new ConversationalAIController(tenantId, sessionId);
    const history = await aiService.getConversationHistory();

    res.status(200).json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching history',
      error: message(error),
    });
  }
});

router.post('/reset/:sessionId', protect, async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId ?? '');
    const tenantId = workspaceIdOf(req);
    if (!tenantId) return noWorkspace(res);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required',
      });
    }

    const aiService = new ConversationalAIController(tenantId, sessionId);
    const newSessionId = await aiService.resetConversation();

    res.status(200).json({
      success: true,
      message: 'Conversation reset successfully',
      sessionId: newSessionId,
    });
  } catch (error) {
    console.error('Error resetting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting conversation',
      error: message(error),
    });
  }
});

// Get document for editing
router.get('/:type/:id', protect, async (req: Request, res: Response) => {
  try {
    const { type, id } = req.params as { type: DocumentType | string; id: string };
    const tenantId = workspaceIdOf(req);
    // Without this the `where` below would carry `tenantId: undefined`, which
    // Prisma drops from the filter entirely — turning a workspace-scoped read
    // into a cross-tenant one.
    if (!tenantId) return noWorkspace(res);

    let document;
    // Scope all lookups by tenantId so cross-tenant access is impossible.
    switch (type) {
      case 'invoice':
        document = await prisma.invoice.findFirst({ where: { id, tenantId, isDeleted: false } });
        break;
      case 'quotation':
        document = await prisma.quotation.findFirst({ where: { id, tenantId, isDeleted: false } });
        break;
      case 'expense':
        document = await prisma.expense.findFirst({ where: { id, tenantId, isDeleted: false } });
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid document type' });
    }

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.status(200).json({ success: true, data: document });
  } catch (error) {
    res.status(500).json({ success: false, message: message(error) });
  }
});

// Soft delete document
router.delete('/:type/:id', protect, async (req: Request, res: Response) => {
  try {
    const { type, id } = req.params as { type: DocumentType | string; id: string };
    const tenantId = workspaceIdOf(req);
    // Without this the `where` below would carry `tenantId: undefined`, which
    // Prisma drops from the filter entirely — turning a workspace-scoped read
    // into a cross-tenant one.
    if (!tenantId) return noWorkspace(res);

    let document;
    // Use updateMany scoped to tenantId so a cross-tenant soft-delete is
    // impossible (equivalent to Mongoose's findOneAndUpdate with tenantId
    // in the filter). updateMany returns a count; we then re-fetch the
    // record to return the same shape as the previous implementation.
    switch (type) {
      case 'invoice': {
        const result = await prisma.invoice.updateMany({
          where: { id, tenantId },
          data: { isDeleted: true },
        });
        if (result.count === 0) {
          document = null;
          break;
        }
        document = await prisma.invoice.findFirst({ where: { id, tenantId } });
        break;
      }
      case 'quotation': {
        const result = await prisma.quotation.updateMany({
          where: { id, tenantId },
          data: { isDeleted: true },
        });
        if (result.count === 0) {
          document = null;
          break;
        }
        document = await prisma.quotation.findFirst({ where: { id, tenantId } });
        break;
      }
      case 'expense': {
        const result = await prisma.expense.updateMany({
          where: { id, tenantId },
          data: { isDeleted: true },
        });
        if (result.count === 0) {
          document = null;
          break;
        }
        document = await prisma.expense.findFirst({ where: { id, tenantId } });
        break;
      }
      default:
        return res.status(400).json({ success: false, message: 'Invalid document type' });
    }

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.status(200).json({
      success: true,
      message: `${type} deleted successfully`,
      data: document,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: message(error) });
  }
});

export default router;
