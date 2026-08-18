function getNextRecurringDate(invoiceDate, recurring, recurringDuration) {
    const date = new Date(invoiceDate);
    if (recurring === 'days') date.setDate(date.getDate() + recurringDuration);
    if (recurring === 'months') date.setMonth(date.getMonth() + recurringDuration);
    if (recurring === 'years') date.setFullYear(date.getFullYear() + recurringDuration);
    return date;
}

module.exports = getNextRecurringDate;
