use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Invalid deal parameters")]
    InvalidParams,
    #[msg("Sender is not allowed to do this")]
    Unauthorized,
    #[msg("Deal is not in the required status")]
    WrongStatus,
    #[msg("Too early")]
    TooEarly,
    #[msg("Too late")]
    TooLate,
    #[msg("The vault did not receive the full amount (transfer-fee mints are not supported)")]
    TransferFailed,
}
