"""ORM models (persistence shape only). Importing this package registers every table."""

from app.models.back_office import (  # noqa: F401
    AuditLogRow, DomainEventRow, ExpenseRow, IdempotencyRecordRow, OfflineSubmissionRow, SequenceRow,
    SettingsDocumentRow, SettingsHistoryRow,
)
from app.models.catalog import (  # noqa: F401
    CategoryRow, ChoiceGroupRow, ChoiceOptionEffectRow, ChoiceOptionRow, DiscountRow, IngredientRow, PosSnapshotRow, ProductChoiceGroupRow,
    ProductRow, RecipeLineRow, RecipeRow, StockLevelRow, StockMovementRow,
)
from app.models.identity import (  # noqa: F401
    BusinessRow, PermissionRow, RolePermissionRow, RoleRow, SessionRow, SystemStateRow, TerminalRow, UserRow,
)
from app.models.sales import (  # noqa: F401
    DocumentPrintRow, DocumentRow, DocumentSeriesRow, OrderDiscountRow, OrderItemChoiceRow, OrderItemRow, OrderRow,
    PaymentRow, RefundAllocationRow, RefundLineRow, RefundRow,
)
