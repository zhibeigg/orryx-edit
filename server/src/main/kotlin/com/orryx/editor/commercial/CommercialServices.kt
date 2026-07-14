package com.orryx.editor.commercial

import com.orryx.editor.ai.AiJobRepository
import com.orryx.editor.ai.AiJobService
import com.orryx.editor.auth.AccountService
import com.orryx.editor.auth.SessionService
import com.orryx.editor.claim.ClaimService
import com.orryx.editor.config.AccountWebConfig
import com.orryx.editor.config.CommercialFeatureConfig
import com.orryx.editor.draft.DraftService
import com.orryx.editor.entitlement.EntitlementService
import com.orryx.editor.payment.PaymentService
import com.orryx.editor.snapshot.SnapshotService
import com.orryx.editor.wallet.WalletService
import java.net.URI

data class CommercialServices(
    val features: CommercialFeatureConfig,
    val accountWeb: AccountWebConfig,
    val accounts: AccountService,
    val sessions: SessionService,
    val claims: ClaimService,
    val entitlements: EntitlementService,
    val wallets: WalletService,
    val payment: PaymentService? = null,
    val paymentGateway: URI? = null,
    val drafts: DraftService? = null,
    val snapshots: SnapshotService? = null,
    val aiJobs: AiJobService? = null,
    val aiJobRepository: AiJobRepository? = null
)
