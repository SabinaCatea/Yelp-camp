if(process.env.NODE_ENV !== 'production')
{
    require('dotenv').config();
}
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const Campground = require('./models/campground');
const Review = require('./models/review');
const User = require('./models/user');
const methodOverride = require('method-override');
const ejsMate = require('ejs-mate');
const session = require('express-session');
const flash = require('connect-flash');
const catchAsync = require('./utils/catchAsync');
const ExpressError = require('./utils/ExpressError');
const Joi = require('joi');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const {isLoggedIn, storeReturnTo} = require('./middleware')
const multer = require('multer');
const {storage, cloudinary} = require('./cloudinary')
const upload = multer({storage})
const mbxGeocoding = require("@mapbox/mapbox-sdk/services/geocoding");
const mapBoxToxen = process.env.MAPBOX_TOXEN;
const geocoder = mbxGeocoding({accessToken: mapBoxToxen});
const { campgroundSchema, reviewSchema } = require('./schemas');
const mongoSanitize = require('express-mongo-sanitize');
const helmet = require('helmet');
const { MongoStore } = require('connect-mongo');
const dbURL = process.env.DB_URL;
// const dbURL = 'mongodb://0.0.0.0:27017/yelp-camp'
const MongoDBStore = require("connect-mongo")(session);

// mongodb://0.0.0.0:27017/yelp-camp
mongoose.connect(dbURL);

const store = new MongoDBStore({
    url: dbURL,
    secret: 'thisshouldbesecret',
    touchAfter: 24 * 60 * 60
});

store.on("error", function(e){
    console.log("SESSION STORE ERROR", e)
})

const sessionConfig = {
    store,
    name: 'session',
    secret:'thisshouldbesecret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}


const db = mongoose.connection;
db.on("error", console.error.bind(console,"connection error:"));
db.once("open",()=>{
    console.log("Database connected");
});


const app = express();
app.use(session(sessionConfig));
app.use(flash());
app.use(helmet({contentSecurityPolicy: false}));

const scriptSrcUrls = [
    "https://stackpath.bootstrapcdn.com/",
    "https://api.tiles.mapbox.com/",
    "https://api.mapbox.com/",
    "https://kit.fontawesome.com/",
    "https://cdnjs.cloudflare.com/",
    "https://cdn.jsdelivr.net",
];
//This is the array that needs added to
const styleSrcUrls = [
    "https://kit-free.fontawesome.com/",
    "https://api.mapbox.com/",
    "https://api.tiles.mapbox.com/",
    "https://fonts.googleapis.com/",
    "https://use.fontawesome.com/",
    "https://cdn.jsdelivr.net",
];
const connectSrcUrls = [
    "https://api.mapbox.com/",
    "https://a.tiles.mapbox.com/",
    "https://b.tiles.mapbox.com/",
    "https://events.mapbox.com/",
];
const fontSrcUrls = [];
app.use(
    helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: [],
            connectSrc: ["'self'", ...connectSrcUrls],
            scriptSrc: ["'unsafe-inline'", "'self'", ...scriptSrcUrls],
            styleSrc: ["'self'", "'unsafe-inline'", ...styleSrcUrls],
            workerSrc: ["'self'", "blob:"],
            objectSrc: [],
            imgSrc: [
                "'self'",
                "blob:",
                "data:",
                "https://res.cloudinary.com/dsy4kpcfr/", //SHOULD MATCH YOUR CLOUDINARY ACCOUNT! 
                "https://images.unsplash.com/",
            ],
            fontSrc: ["'self'", ...fontSrcUrls],
        },
    })
);


app.use(mongoSanitize());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next)=>{
    res.locals.currentUser = req.user;
    console.log('currentUser', res.locals.currentUser)
    console.log('req user', req.query)
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
})

const validateCampground = (req, res, next)=>{

    const { error } = campgroundSchema.validate(req.body);
    if(error){
        const msg = error.details.map(el => el.message).join(',')
        throw new ExpressError(msg, 400)
    } else { 
        next()
    }
}
const validateReview = (req, res, next)=>{

    const { error } = reviewSchema.validate(req.body);
    if(error){
        const msg = error.details.map(el => el.message).join(',')
        throw new ExpressError(msg, 400)
    } else { 
        next()
    }
}

app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'))

app.use(express.urlencoded({extended: true}))
app.use(methodOverride('_method'));

app.get('/',(req,res)=>{
    res.render('home')
})

app.get('/register',(req,res)=>{
    res.render('user/register')
})

app.post('/register', catchAsync(async (req, res) => {
    try{
        const { email, username, password} = req.body;
        const user = new User({email, username});
        console.log('user', req)
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err =>{
            if(err) return next(err);
            req.flash('success', 'Welcome to Yelp Camp!');
            res.redirect('/campgrounds')
        })
    } catch(e){
        req.flash('error', e.message);
        res.redirect('register');
    }
}))

app.get('/login', (req, res)=>{
    res.render('user/login')
})

app.post('/login',storeReturnTo, passport.authenticate('local', {failureFlash: true, failureRedirect: '/login'}),(req, res)=>{
    req.flash('success','Welcome back!');
    const redirectUrl = res.locals.returnTo || '/campgrounds';
    res.redirect(redirectUrl);
})
// app.get('/makecampground',async (req,res)=>{
//     const camp = new Campground({title: "My Backyard", description: "cheap camping"});
//     await camp.save();
//     res.send(camp)
// })
app.get('/logout', (req, res, next)=>{
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        req.flash('success', 'Goodbye!');
        res.redirect('/campgrounds');
    });
})
app.get('/campgrounds', async (req, res)=>{
        const campgrounds = await Campground.find({});
        res.render('campgrounds/index', {campgrounds})
})

app.get('/campgrounds/new', isLoggedIn, (req, res)=>{
    // const campground = await Campground.findById(req.params.id)
    res.render('campgrounds/new')
})

app.post('/campgrounds', upload.array('image'),validateCampground, catchAsync(async(req, res, next)=>{
    //    if(!req.body.campground) new ExpressError('Empty form', 500)
    const geoData = await geocoder.forwardGeocode({
        query: req.body.campground.location,
        limit: 1
    }).send()
    const campground = new Campground(req.body.campground);
    campground.geometry = geoData.body.features[0].geometry;
    campground.images = req.files.map(f =>({url: f.path, filename: f.filename}));
    campground.author = req.user._id;
    await campground.save();
    req.flash('success','Successfully made a new campground!')
    res.redirect(`/campgrounds/${campground._id}`)
    // const geoData = await geocoder.forwardGeocode({
    //     query: req.body.campground.location,
    //     limit: 1
    // }).send()
    // const campground = new Campground(req.body.campground);
    // campground.geometry = geoData.body.features[0].geometry;
    // campground.images = req.files.map(f => ({ url: f.path, filename: f.filename }));
    // campground.author = req.user._id;
    // await campground.save();
    // console.log(campground);
    // req.flash('success', 'Successfully made a new campground!');
    // res.redirect(`/campgrounds/${campground._id}`)

}))
// app.post('/campgrounds',upload.array('image'),(req,res, next)=>{
//     console.log(req.body, req.files)
//     res.send('IT WORKED')
// })

app.get('/campgrounds/:id', async (req, res)=>{
    const campground = await Campground.findById(req.params.id).populate({
        path: 'reviews',
        populate: {
            path: 'author'
        }
    }).populate('author');   console.log(campground)
    if(!campground){
        req.flash('error','Cannot find that campground!')
    }
    res.render('campgrounds/show', {campground})
})

app.get('/campgrounds/:id/edit', isLoggedIn,  async (req, res)=>{
    const campground = await Campground.findById(req.params.id)
    console.log('campground', req.user._id)
    if(!campground.author?.equals(req.user._id)){
        req.flash('error', 'You do not have permission to do that!');
        return res.redirect(`/campgrounds/${id}`);
    }
    res.render('campgrounds/edit', {campground})
})

app.put('/campgrounds/:id',upload.array('image'), async (req, res, next)=>{
    const {id} = req.params;
    // const campground = await Campground.findById(id);
    const campground = await Campground.findByIdAndUpdate(id, {...req.body.campground});
    const imgs = req.files.map(f =>({url: f.path, filename: f.filename}));
    campground.images.push(...imgs)
    // if(!campground.author?.equals(req.user._id)){
    //     req.flash('error', 'You do not have permission to do that!');
    //     return res.redirect(`/campgrounds/${id}`);
    // }

    if(req.body.deleteImages){
        for(let filename of req.body.deleteImages){
            cloudinary.uploader.destroy(filename)
        }
        await campground.updateOne({ $pull: {images: { filename: { $in: req.body.deleteImages }}}})
    }
    await campground.save();
    req.flash('success', 'Successfully updated campground!');
    res.redirect(`/campgrounds/${campground._id}`)
})

app.delete("/campgrounds/:id", async (req, res)=>{
    const {id} = req.params;
    await Campground.findByIdAndDelete(id);
    res.redirect('/campgrounds');
})

app.post("/campgrounds/:id/reviews",validateReview, catchAsync(async (req, res)=>{
    const campground = await Campground.findById(req.params.id);
    const review = new Review(req.body.review);
    review.author = req.user._id;
    campground.reviews.push(review);
    await review.save();
    await campground.save();
    req.flash('success', 'Create new review!');
    res.redirect(`/campgrounds/${campground._id}`);
  
}))

app.delete('/campgrounds/:id/reviews/:reviewId', async(req, res)=>{
    const {id, reviewId} = req.params;
    await Campground.findByIdAndUpdate(id, {$pull: {reviews: reviewId}})
    await Review.findByIdAndDelete(reviewId)
    req.flash('success', 'Successfully deleted review!');
    res.redirect(`/campgrounds/${id}`)
})


app.all('*',(req, res, next)=>{
    next( new ExpressError('Not matching', 404));
})
app.use((err, req, res, next)=>{
    const {statusCode = 500 } = err;
    if(!err.message) err.message = "Something went wrong!"
    res.status(statusCode).render('error', { err });
})

app.listen(3000, ()=>{
    console.log('serving on port 3000')
})