import { prisma } from '../src/db/client.js'
import { createEntry } from '../src/createEntry.js'

const inputs = [
    "Confirming the dentist next Tuesday at 3pm.\nAlso car insurance is due Friday.",
    "Your package was delivered to the front porch.\nLet us know if anything's missing.",
    "Reminder: rent is due on the 1st.\nLate fee kicks in after the 5th.",
    "Hey, are we still on for lunch Thursday?\nLet me know what time works.",
    "CONGRATULATIONS! You've been selected for a $1,000 gift card.\nClick here to claim before it expires!",
    "Your Amazon order has shipped.\nEstimated arrival: Wednesday by 8pm.",
    "Don't forget to pick up milk and eggs on the way home.\nWe're also out of coffee.",
    "Thanks for applying to Northwood University!\nYour application status is now under review.",
    "Your electricity bill is ready to view.\nAmount due: $84.32 by the 15th.",
    "Quick reminder about the team standup at 9:30.\nBring your updates from last sprint.",
    "We noticed unusual activity on your account.\nPlease verify your identity to avoid suspension.",
    "Mom called, can you call her back tonight?\nSomething about the family dinner Sunday.",
    "Your prescription is ready for pickup at the pharmacy.\nOpen until 9pm tonight.",
    "Final notice: your car's extended warranty is about to expire.\nAct now to renew coverage!",
    "Parent-teacher conference is scheduled for next Monday.\nPlease confirm your time slot.",
    "Your flight to Denver has been delayed by 45 minutes.\nNew departure: 6:15pm.",
    "Gym membership renews automatically on the 20th.\nUpdate your payment info if needed.",
    "Hi! Just following up on the invoice I sent last week.\nLet me know if you have questions.",
    "Your subscription to StreamFlix will renew for $15.99.\nManage your plan anytime.",
    "Reminder: garbage and recycling pickup is tomorrow morning.\nPut bins out tonight.",
    "You're invited to Sarah's birthday party Saturday at 7.\nRSVP when you get a chance!"/*,
    "Your bank statement for June is now available.\nLog in to view your transactions.",
    "Limited time offer: 50% off all winter coats!\nSale ends Sunday at midnight.",
    "The plumber can come by Thursday between 1 and 4.\nWill someone be home?",
    "Your interview with HR is confirmed for Tuesday at 10am.\nPlease bring two forms of ID.",
    "Don't miss out! Your cart items are selling fast.\nComplete your purchase now.",
    "Vet appointment for Max is next Wednesday at 11.\nPlease arrive 10 minutes early.",
    "Your password was recently changed.\nIf this wasn't you, contact support immediately.",
    "Thanks for registering for the 5K!\nCheck-in opens at 7am race day.",
    "Heads up, the meeting moved to Conference Room B.\nSame time, just a new spot.",
    "Your monthly credit score update is here.\nSee what changed this month.",
    "We're hiring! Open positions in your area.\nApply today and start next week.",
    "Library books are due back Friday.\nRenew online to avoid late fees.",
    "Your table reservation for 4 is confirmed for 8pm.\nSee you Saturday!",
    "Action required: update your tax information before April 15.\nForms attached.",
    "Hey, did you ever send me that file?\nNo rush, just checking.",
    "Your oil change is overdue based on mileage.\nSchedule service this week for a discount.",
    "Welcome to the neighborhood newsletter!\nThis month: block party details inside.",
    "Your refund of $42.18 has been processed.\nAllow 3-5 business days to appear.",
    "Reminder: jury duty summons for July 8th.\nReport to the courthouse by 8am.",
    "You have 3 unread messages from your group chat.\nTap to catch up.",
    "Spring cleaning sale at the hardware store!\nBuy one get one half off this weekend.",
    "Your doctor's office is following up on test results.\nPlease call to schedule a visit.",
    "Don't forget to water the plants while we're away.\nKey is under the mat.",
    "Your domain name is set to expire in 14 days.\nRenew now to keep your website live.",
    "Congrats grad! Order your cap and gown by Friday.\nSizes are going fast.",
    "Your ride is arriving in 3 minutes.\nLook for a silver Honda Civic.",
    "Account alert: your balance is below $50.\nConsider transferring funds soon.",
    "The HOA meeting is rescheduled to next Tuesday.\nAgenda will be emailed beforehand.",
    "Thanks for your order! Leave a review and get 10% off next time.\nWe'd love your feedback."*/
];

async function main() {
    for (const text of inputs) {
        const entry = await createEntry(text)
        console.log('Created entry:', entry)
    }
}

main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
        console.error(e)
        prisma.$disconnect()
    })
