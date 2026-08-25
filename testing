import { Request, Response } from "express";
import { saveFormProgress, getAllSubmissions } from "../utils/submissions";
import {
  approveCustomer,
  rejectCustomer,
  removeCustomer,
  getAllCustomers,
} from "../utils/customers";
import { sendCustomerConfirmationEmail } from "./briefing";
import { logCustomerApproval, logCustomerRejection } from "../lib/audit-log";

// Middleware to check if user is admin
export function isAdminEmail(email: string): boolean {
  return email.endsWith("@itmethods.com");
}

export async function handleSaveProgress(req: Request, res: Response) {
  try {
    const { email, company, stepNumber, stepData, isCompleted, fullData } =
      req.body;

    if (!email || !company || stepNumber === undefined) {
      console.warn("Missing required fields:", { email, company, stepNumber });
      return res.status(400).json({
        error: "Missing required fields: email, company, stepNumber",
      });
    }

    // Skip email validation for temporary progress saves (temp_* emails)
    if (!email.startsWith("temp_") && !email.match(/^[\w.-]+@[\w.-]+\.\w+$/)) {
      console.warn("Invalid email format:", email);
      return res.status(400).json({
        error: "Invalid email format",
      });
    }

    const submission = await saveFormProgress(
      email,
      company,
      stepNumber,
      stepData,
      isCompleted,
      fullData,
    );

    return res.status(200).json({
      success: true,
      submission,
    });
  } catch (error) {
    console.error("Error saving form progress:", error);
    return res.status(500).json({
      error: "Failed to save form progress",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function handleGetSubmissions(req: Request, res: Response) {
  try {
    const { adminEmail } = req.query;

    // Verify admin access
    if (!adminEmail || !isAdminEmail(String(adminEmail))) {
      return res.status(403).json({
        error: "Unauthorized: only @itmethods.com emails can view submissions",
      });
    }

    const submissions = await getAllSubmissions();

    return res.status(200).json({
      success: true,
      submissions,
      count: submissions.length,
      completed: submissions.filter((s) => s.isCompleted).length,
      partial: submissions.filter((s) => !s.isCompleted).length,
    });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return res.status(500).json({
      error: "Failed to fetch submissions",
    });
  }
}

export async function handleApproveCustomer(req: Request, res: Response) {
  try {
    const { adminEmail, customerEmail } = req.body;

    // Verify admin access
    if (!adminEmail || !isAdminEmail(adminEmail)) {
      return res.status(403).json({
        error: "Unauthorized: only @itmethods.com emails can approve customers",
      });
    }

    if (!customerEmail) {
      return res.status(400).json({
        error: "Missing customerEmail parameter",
      });
    }

    // Approve the customer
    const customer = await approveCustomer(customerEmail, adminEmail);

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found",
      });
    }

    // Log the approval for audit trail
    await logCustomerApproval(adminEmail, customerEmail, req);

    // Send confirmation email to customer
    const emailSent = await sendCustomerConfirmationEmail(
      customer.email,
      customer.name,
      customer.company,
    );

    return res.status(200).json({
      success: true,
      message: "Customer approved and confirmation email sent",
      customer,
      emailSent,
    });
  } catch (error) {
    console.error("Error approving customer:", error);
    return res.status(500).json({
      error: "Failed to approve customer",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function handleRejectCustomer(req: Request, res: Response) {
  try {
    const { adminEmail, customerEmail } = req.body;

    // Verify admin access
    if (!adminEmail || !isAdminEmail(adminEmail)) {
      return res.status(403).json({
        error: "Unauthorized: only @itmethods.com emails can reject customers",
      });
    }

    if (!customerEmail) {
      return res.status(400).json({
        error: "Missing customerEmail parameter",
      });
    }

    // Reject the customer
    const customer = await rejectCustomer(customerEmail);

    if (!customer) {
      return res.status(404).json({
        error: "Customer not found",
      });
    }

    // Log the rejection for audit trail
    await logCustomerRejection(adminEmail, customerEmail, req);

    return res.status(200).json({
      success: true,
      message: "Customer rejected",
      customer,
    });
  } catch (error) {
    console.error("Error rejecting customer:", error);
    return res.status(500).json({
      error: "Failed to reject customer",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function handleRemoveCustomer(req: Request, res: Response) {
  try {
    const { adminEmail, customerEmail } = req.body;

    // Verify admin access
    if (!adminEmail || !isAdminEmail(adminEmail)) {
      return res.status(403).json({
        error: "Unauthorized: only @itmethods.com emails can remove customers",
      });
    }

    if (!customerEmail) {
      return res.status(400).json({
        error: "Missing customerEmail parameter",
      });
    }

    // Remove the customer
    const removed = await removeCustomer(customerEmail);

    if (!removed) {
      return res.status(404).json({
        error: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Customer removed",
    });
  } catch (error) {
    console.error("Error removing customer:", error);
    return res.status(500).json({
      error: "Failed to remove customer",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function handleGetAllCustomers(req: Request, res: Response) {
  try {
    const { adminEmail } = req.query;

    // Verify admin access
    if (!adminEmail || !isAdminEmail(String(adminEmail))) {
      return res.status(403).json({
        error: "Unauthorized: only @itmethods.com emails can view customers",
      });
    }

    const customers = await getAllCustomers();

    // Separate by approval status
    const pending = customers.filter((c) => c.approvalStatus === "pending");
    const approved = customers.filter((c) => c.approvalStatus === "approved");
    const rejected = customers.filter((c) => c.approvalStatus === "rejected");

    return res.status(200).json({
      success: true,
      customers,
      pending,
      approved,
      rejected,
      count: customers.length,
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    return res.status(500).json({
      error: "Failed to fetch customers",
    });
  }
}
