The user wants to refine the "aprovado" (approved) flow and related UI/UX aspects, focusing on making it professional, easy for laypeople to use, and fixing specific issues like the "invalidate" button, visual layout, and the setup process for post-sale messages.

### Proposed Changes

#### 1. CRM & Validation Improvements
- **Invalidate Client**: Enhance the "invalidate" functionality in `PendingApprovalDialog.tsx` to ensure it's prominent and works as expected. The user mentioned some are marked as validated but aren't.
- **Visual Cleanup**: Clean up the "Pending Approval" dialog. Improve the display of customers without phone numbers (using `isPlaceholderPhone` from `format.ts`).
- **Layout Organization**: Move the distribution flow to the top as requested, removing or hiding the diagram and spreadsheet by default (keeping code for future use).
- **Consolidation**: Combine "Create" and "Build" flow buttons into a single "Build Flow" button to avoid confusion.

#### 2. WhatsApp Link Customization
- **Shortener**: Implement a simpler/smaller WhatsApp link generator to replace the long current links.

#### 3. Post-Sale Configuration Wizard (Aprovado, Reprovado, etc.)
- **Simplified Setup**: Refine `PosVendaSetupWizard.tsx` to make it more intuitive for laypeople. Add small help buttons/popups explaining each step.
- **Media Customization**: Ensure the "Aprovado", "Reprovado", "30/60/90/120 days" stages are fully customizable (audio, image, text, video) and easy to configure.
- **Preview Integration**: Ensure the preview correctly shows audio, video, and images exactly as they will appear.

#### 4. UI/UX Refinement
- **Modern Look**: Apply a more consistent "premium" visual style across these components (shadows, border-radius, gradients, clean spacing).
- **Responsive Preview**: Use an iPhone 14 Pro Max frame for the mobile preview as requested.
- **Help Popups**: Add help icons with tooltips or popups for each step to guide users.

### Technical Details

- **Files to Modify**:
    - `src/components/whatsapp/PendingApprovalDialog.tsx`: UI layout, invalidate button, scope filtering.
    - `src/components/whatsapp/PosVendaSetupWizard.tsx`: Setup experience, help buttons, preview size/style.
    - `src/pages/WhatsAppClientsPage.tsx`: Top-level layout, button consolidation.
    - `src/lib/posVenda/format.ts`: Potential additions for link shortening logic.
    - `src/components/whatsapp/PosVendaKanban.tsx`: UI cleanup.
- **Database**: The `customers` table already has `pos_venda_invalid` and `pos_venda_pending_stage`, which we'll continue to use.
- **Infrastructure**: No new infrastructure required, primarily frontend (React/Tailwind) changes.
