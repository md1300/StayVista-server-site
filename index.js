const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId, Timestamp } = require('mongodb')
const jwt = require('jsonwebtoken')
const nodemailer = require("nodemailer");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 8000

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 
    'http://localhost:5174',
    'https://vistastay-live.web.app'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())


const sendEmail = (emailAddress, emailData) => {

const transporter = nodemailer.createTransport({
  service:'gmail',
  host:  'smtp.gmail.com',
  port: 587,
  secure: false, // true for port 465, false for other ports
  auth: {
    user: process.env.TRANSPORTER_EMAIL,
    pass: process.env.TRANSPORTER_PASS,
  },
});
// verify transporter
  // verify connection configuration
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error)
    } else {
      console.log('Server is ready to take our messages')
    }
  })
  const mailBody = {
    from: `"StayVista" <${process.env.TRANSPORTER_EMAIL}>`, // sender address
    to: emailAddress, // list of receivers
    subject: emailData.subject, // Subject line
    html: emailData.message, // html body
  }

  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error)
    } else {
      console.log('Email Sent: ' + info.response)
    }
  })
}


// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  // console.log(token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

const uri = `mongodb+srv://${process.env.DB_USERS}:${process.env.DB_PASS}@cluster0.vmhty.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    // ----collection ----------------
    const db = client.db('stayvista')
    const roomsCollection = db.collection('rooms');
    const usersCollection = db.collection('users');
    const bookingsCollection = db.collection('bookings');
    // -------verify admin middleware ------------

    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email }
      const result = await usersCollection.findOne(query)
      if (!result || result?.role !== 'admin') return res.status(401).send({ message: 'unauthorized access !!' })
      next()
    }

    // ---------- verify host middleware ---------
    const verifyHost = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email }
      const result = await usersCollection.findOne(query)
      if (!result || result?.role !== 'host') return res.status(401).send({ message: 'unauthorized access' })
      next()
    }

    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        // console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })


    // create-payment-intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseFloat(price) * 100;

      if (!price || priceInCent < 1) return
      // Create a PaymentIntent with the order amount and currency
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      })
      res.send({ clientSecret: client_secret })
    })


    // ------save a user data in db ------------
    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      // check the user already exits in db ------------
      const isExit = await usersCollection.findOne(query)
      if (isExit) {
        if (user.status === 'requested') {
          const result = await usersCollection.updateOne(query, { $set: { status: user?.status } })
          return res.send(result)
        }
        return res.send(isExit)
      }
      // save user for the first time ------------
      const options = { upsert: true };
      const updateOne = {
        $set: {
          ...user,
          timestamp: Date.now()
        }
      }
      const result = await usersCollection.updateOne(query, updateOne, options)
      res.send(result)
    })
    // --------get all users data from usersCollection ------------
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })
    // --------------get specific  user's data from usersCollection ---------
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email }
      const result = await usersCollection.findOne(query)
      res.send(result)
    })
    // --------change user role by admin  from usersCollection -----
    app.patch('/user/:email', async (req, res) => {
      const email = req.params.email;

      const user = req.body;
      const query = { email: email }
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() }

      }
      const result = await usersCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    // ------------get data from roomsCollection ------
    app.get('/rooms', async (req, res) => {
      const category = req.query.category
      let query = {}
      if (category && category !== 'null') query = { category }
      const result = await roomsCollection.find(query).toArray()
      res.send(result)
    })
    //  ------------------------post data in roomsCollection ---------
    app.post('/room', verifyToken, verifyHost, async (req, res) => {
      const roomData = req.body;
      const result = await roomsCollection.insertOne(roomData)
      res.send(result)
    })
    // get all room data for host ----------

    app.get('/my-listings/:email', verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;

      const query = { 'host.email': email };
      const result = await roomsCollection.find(query).toArray()
      res.send(result)

    })
    //  --------------detete data from roomCollection ------------
    app.delete('/room/:id', verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await roomsCollection.deleteOne(query)
      res.send(result)
    })
    // ------------------------------
    app.get('/rooms/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await roomsCollection.findOne(query)
      res.send(result)
    })

    //  save a booking data in db bookings collection ----------
    app.post('/booking', verifyToken, async (req, res) => {
      const bookingData = req.body;
      // save room booking info --------
      const result = await bookingsCollection.insertOne(bookingData)
      // ---------------change room availability status ------
      // const roomId=bookingData.roomId;
      // const query={_id:new ObjectId(roomId)}
      // const updateDoc={
      //  $set:{
      //   booked:true
      //  }
      // }
      // const updateRoom=await roomsCollection.updateOne(query,updateDoc)
      
    // send email to guest
    sendEmail(bookingData?.guest?.email, {
      subject: 'Booking Successful!',
      message: `You've successfully booked a room through StayVista. Transaction Id: ${bookingData.transactionId}`,
    })
    // send email to host
    sendEmail(bookingData?.host?.email, {
      subject: 'Your room got booked!',
      message: `Get ready to welcome ${bookingData.guest.name}.`,
    })

      res.send(result)
    })

    // ------ update room status-----------
    app.patch('/room/status/:id', async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      // change room availability status 
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          booked: status
        }
      }
      const result = await roomsCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    // get all booking  for guest ----------

    app.get('/my-bookings/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { 'guest.email': email }
      const result = await bookingsCollection.find(query).toArray()
      res.send(result)
    })

    // cancel booking from my booking ----------
    app.delete('/booking/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await bookingsCollection.deleteOne(query)
      res.send(result)
    })

    // get all booking  for host ----------
    app.get('/manage-bookings/:email', verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;
      const query = { 'host.email': email }
      const result = await bookingsCollection.find(query).toArray()
      res.send(result)
    })

    //  -----------admin statistic ----------
    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const bookingDetails = await bookingsCollection.find({}, {
        projection: {
          data: 1,
          price: 1
        }
      }).toArray();
      const totalUsers = await usersCollection.countDocuments();
      const totalRooms = await roomsCollection.countDocuments();
      const totalPrice = bookingDetails.reduce((sum, booking) => sum + booking.price, 0)

      // const data = [
      //   ['Day', 'Sales'],
      //   ['9/5', 1000],
      //   ['10/2', 1170],
      //   ['11/1', 660],
      //   ['12/11', 1030],
      // ]
      const chartData = bookingDetails.map(booking => {
        const day = new Date(booking.data).getDate()
        const month = new Date(booking.data).getMonth() + 1
        const data = [`${day}/${month}`, booking?.price]
        return data
      })
      chartData.unshift(['Day', 'Sales'])
      // chartData.splice(0, 0, ['Day', 'Sales'])

      res.send({ totalBookings: bookingDetails.length, totalUsers, totalRooms, totalPrice, chartData })
    })

    // --------host statistic ---------

    app.get('/host-stat', verifyToken, verifyHost, async (req, res) => {
      const email = req.user.email;
    
      const bookingDetails = await bookingsCollection.find({ 'host.email': email }, {
        projection: {
          data: 1,
          price: 1,
        }
      }).toArray()
      const totalRooms = await roomsCollection.countDocuments({
        'host.email': email
      })
      const totalPrice = bookingDetails.reduce((sum, booking) => sum + booking.price, 0);
     
     const {timestamp}=await usersCollection.findOne({email},{
      projection:{
        timestamp:1
      }
     })

      const chartData = bookingDetails.map(booking => {
        const day = new Date(booking?.data).getDate()
        const month = new Date(booking?.data).getMonth()
        const data = [`${day}/ ${month}`, booking?.price]
        return data

      })
      chartData.unshift(['Day', 'Sales'])
      // chartData.splice(0, 0, ['Day', 'Sales'])
      // console.log(chartData)
      // console.log(bookingDetails)

      res.send({
        chartData, totalPrice, totalRooms, totalBookings: bookingDetails.length, hostSince: timestamp,
      })

    })
    
    // ------guest statistic -----------------
  app.get('/guest-stat',verifyToken,async(req,res)=>{
  
    const email=req.user.email;

    const {timestamp}=await usersCollection.findOne({email},{
      projection:{
        timestamp:1,
      }
    })

    const bookingDetails=await bookingsCollection.find({'guest.email':email},{
      projection:{
        price:1,
        data:1,
      }
    }).toArray();
    const totalPrice=bookingDetails.reduce((sum,booking)=>sum+booking.price,0)
    const chartData=bookingDetails.map(booking=>{
      const day=new Date(booking?.data).getDate()
      const month=new Date(booking?.data).getMonth()    
      const data=[`${day}/${month}`,booking?.price]
     return data
    })
    chartData.unshift(['day','buyes'])
   
    console.log(totalPrice)
    
    res.send({guestSince:timestamp,totalPrice,totalBookings:bookingDetails.length,chartData})
  })
  // ------------update room data -----------
  
  app.patch('/room/update/:id',verifyToken,verifyHost, async(req,res)=>{
    const id=req.params.id;
    // console.log(id)
    const roomData=req.body;
    const filter={_id:new ObjectId(id)}
    const updateDoc={
      $set:{...roomData}
    }
    // console.log(updateDoc)
    const result=await roomsCollection.updateOne(filter,updateDoc)
    // console.log(result)
    res.send(result)
  })

  // test email
// app.get('/email', async (req, res) => {
//   const { data, error } = await resend.emails.send({
//     from: 'StayVista <onboarding@resend.dev>',
//     to: ['xidode6213@acuxi.com'],
//     subject: 'Hello World',
//     html: '<strong>It works!</strong>',
//   })

//   if (error) {
//     return console.error({ error })
//   }

//   res.send({ data })
// })


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..')
})

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`)
})
